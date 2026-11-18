"""КвартМетр: Платформа умного ЖКХ — сервер (Flask + SQLite)."""
import csv, io, math, os, random, sqlite3
from calendar import monthrange
from datetime import date, datetime, timedelta
from functools import wraps

from flask import (Flask, Response, abort, g, jsonify, redirect,
                   render_template, request, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "app.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads")
DEMO_PLAN = "/static/img/demo_plan.svg"

app = Flask(__name__)
app.config.update(SECRET_KEY=os.environ.get("SECRET_KEY", "dev-change-me"),
                  MAX_CONTENT_LENGTH=5 * 1024 * 1024)

BRAND = {
    "name": "КвартМетр",
    "title": "КвартМетр: Платформа умного ЖКХ",
    "tagline": "Умное управление ЖКХ: экономия ресурсов и комфорт каждый день",
}

# ---------- Тарифы и нормы ----------
TARIFF = {"cold": 45.0,     # ХВС, ₽/м³
          "hot": 180.0,     # ГВС, ₽/м³
          "power": 5.5,     # электричество, ₽/кВт·ч
          "heat": 2450.0}   # отопление, ₽/Гкал
RES = tuple(TARIFF)
HEAT_SEASON = {1: 1.2, 2: 1.1, 3: 0.9, 4: 0.6, 5: 0.2, 6: 0.0, 7: 0.0,
               8: 0.0, 9: 0.2, 10: 0.6, 11: 1.0, 12: 1.2}  # доля от полного сезона

SENSOR_TYPES = ("temperature", "humidity", "leak", "smoke", "electricity")
UNITS = {"temperature": "°C", "humidity": "%", "leak": "", "smoke": "", "electricity": "кВт"}
SENSOR_NAMES = {"temperature": "Температура", "humidity": "Влажность", "leak": "Протечка",
                "smoke": "Дым", "electricity": "Электричество"}
# Демо-датчики: тип, x%, y% (положение «острия» метки на демо-плане)
DEMO_SENSORS = [("temperature", 24, 58), ("humidity", 56, 50), ("smoke", 82, 33),
                ("leak", 82, 81), ("electricity", 14, 29)]

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS apartments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  layout_image_url TEXT,
  area REAL NOT NULL DEFAULT 54,        -- м², нужна для расчёта отопления
  residents INTEGER NOT NULL DEFAULT 2); -- человек, нужна для расчёта воды
CREATE TABLE IF NOT EXISTS sensors(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apartment_id INTEGER NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  x_coord REAL NOT NULL,   -- % ширины плана
  y_coord REAL NOT NULL);  -- % высоты плана
CREATE TABLE IF NOT EXISTS readings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sensor_id INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  value REAL NOT NULL,
  timestamp TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_readings_sensor ON readings(sensor_id, id);
"""


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_):
    conn = g.pop("db", None)
    if conn:
        conn.close()


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript(SCHEMA)


@app.context_processor
def inject_brand():
    return {"brand": BRAND, "year": datetime.now().year}


def dated_url_for(endpoint, **values):
    """url_for для статики с параметром ?v=<время изменения файла>: браузер не берёт старый JS/CSS из кэша."""
    if endpoint == "static" and values.get("filename"):
        path = os.path.join(app.root_path, "static", values["filename"])
        if os.path.isfile(path):
            values["v"] = int(os.stat(path).st_mtime)
    return url_for(endpoint, **values)


@app.context_processor
def override_url_for():
    return {"url_for": dated_url_for}


@app.errorhandler(404)
def not_found(_):
    if request.path.startswith("/api/"):
        return jsonify(error="Не найдено"), 404
    return redirect(url_for("index"))


@app.errorhandler(413)
def too_large(_):
    return jsonify(error="Файл больше 5 МБ."), 413


def login_required(view):
    @wraps(view)
    def wrapper(*a, **kw):
        if "user_id" not in session:
            if request.path.startswith("/api/"):
                return jsonify(error="Нужно войти в аккаунт."), 401
            return redirect(url_for("login"))
        return view(*a, **kw)
    return wrapper


def get_apartment(apt_id):
    row = db().execute("SELECT * FROM apartments WHERE id=? AND user_id=?",
                       (apt_id, session["user_id"])).fetchone()
    if row is None:
        abort(404)
    return row


def get_sensor(sid):
    row = db().execute("""SELECT s.* FROM sensors s JOIN apartments a ON a.id = s.apartment_id
                          WHERE s.id=? AND a.user_id=?""", (sid, session["user_id"])).fetchone()
    if row is None:
        abort(404)
    return row


# ---------- Генерация показаний датчиков ----------
def bump(h, center, width):
    return math.exp(-(((h - center) / width) ** 2))


def make_value(stype, now, prev=None):
    """Правдоподобное показание с суточным ритмом."""
    h = now.hour + now.minute / 60
    wave = math.sin((h - 9) / 24 * 2 * math.pi)  # максимум около 15:00
    if stype == "temperature":
        return round(22.0 + 0.8 * wave + random.gauss(0, 0.12), 1)
    if stype == "humidity":
        return round(47 - 3 * wave + random.gauss(0, 0.6), 1)
    if stype == "electricity":  # текущая нагрузка, кВт: утренний и вечерний пики
        kw = 0.25 + 1.2 * bump(h, 8, 1.3) + 1.9 * bump(h, 20, 2.4) + random.gauss(0, 0.04)
        return round(max(0.1, kw), 2)
    if prev == 1 and random.random() < 0.6:  # тревога держится несколько замеров
        return 1
    return 1 if random.random() < 0.006 else 0


def status_of(stype, v):
    if stype in ("leak", "smoke"):
        return "alert" if v >= 1 else "ok"
    if stype == "temperature":
        return "ok" if 19 <= v <= 25 else "warn"
    if stype == "humidity":
        return "ok" if 30 <= v <= 60 else "warn"
    return "ok" if v <= 3.5 else "warn"


def add_reading(sid, stype, prev=None, value=None):
    now = datetime.now()
    value = make_value(stype, now, prev) if value is None else value
    conn = db()
    conn.execute("INSERT INTO readings(sensor_id, value, timestamp) VALUES(?,?,?)",
                 (sid, value, now.isoformat(timespec="seconds")))
    conn.execute("""DELETE FROM readings WHERE sensor_id=? AND id NOT IN
                    (SELECT id FROM readings WHERE sensor_id=? ORDER BY id DESC LIMIT 120)""", (sid, sid))
    return value


def rssi_of(sid, ts):
    """Имитация уровня радиосигнала LoRa в dBm. У каждого датчика своя «дальность» (от −78 до −102),
    плюс небольшой шум, который меняется с каждым новым замером."""
    base = -78 - (sid * 7) % 25
    return int(round(base + random.Random(f"{sid}:{ts}").gauss(0, 1.5)))


def sensor_dict(sid):
    r = db().execute("""SELECT s.id, s.type, s.x_coord, s.y_coord,
        (SELECT value FROM readings WHERE sensor_id=s.id ORDER BY id DESC LIMIT 1) AS value,
        (SELECT timestamp FROM readings WHERE sensor_id=s.id ORDER BY id DESC LIMIT 1) AS ts
        FROM sensors s WHERE s.id=?""", (sid,)).fetchone()
    return {"id": r["id"], "type": r["type"], "x": r["x_coord"], "y": r["y_coord"],
            "value": r["value"], "ts": r["ts"], "unit": UNITS[r["type"]], "rssi": rssi_of(r["id"], r["ts"]),
            "status": status_of(r["type"], r["value"])}


def create_apartment(user_id, name, area, residents):
    conn = db()
    cur = conn.execute("INSERT INTO apartments(user_id, name, layout_image_url, area, residents) VALUES(?,?,?,?,?)",
                       (user_id, name, DEMO_PLAN, area, residents))
    apt_id = cur.lastrowid
    for stype, x, y in DEMO_SENSORS:
        c = conn.execute("INSERT INTO sensors(apartment_id, type, x_coord, y_coord) VALUES(?,?,?,?)",
                         (apt_id, stype, x, y))
        add_reading(c.lastrowid, stype)
    return apt_id


def apt_dict(a):
    return {"id": a["id"], "name": a["name"], "area": a["area"],
            "residents": a["residents"], "layout_image_url": a["layout_image_url"]}


# ---------- Расчёт расходов ЖКХ ----------
def day_factor(apt, d):
    """Детерминированная «погода» дня: выходные чуть выше, остальное — разброс ±12%."""
    r = random.Random(f"{apt['id']}:{d.isoformat()}")
    return (1.12 if d.weekday() >= 5 else 1.0) * r.uniform(0.88, 1.12)


def usage(apt, d, k=None):
    """Потребление за сутки: ХВС/ГВС в м³, электричество в кВт·ч, отопление в Гкал."""
    k = day_factor(apt, d) if k is None else k
    n, area = apt["residents"], apt["area"]
    return {"cold": 0.150 * n * k,                   # ≈ 4,5 м³ на человека в месяц
            "hot": 0.115 * n * k,                    # ≈ 3,5 м³ на человека в месяц
            "power": (2.0 * n + 0.04 * area) * k,
            "heat": area * 0.024 * HEAT_SEASON[d.month] / monthrange(d.year, d.month)[1]}


def month_model(apt, now=None):
    now = now or datetime.now()
    today, frac = now.date(), (now.hour * 60 + now.minute) / 1440
    dim = monthrange(today.year, today.month)[1]
    last7 = [usage(apt, today - timedelta(days=i)) for i in range(1, 8)]
    avg = {k: sum(u[k] for u in last7) / 7 for k in RES}
    rows = []
    for day in range(1, dim + 1):
        d = date(today.year, today.month, day)
        u = usage(apt, d) if d <= today else {**avg, "heat": usage(apt, d)["heat"]}
        c = {k: u[k] * TARIFF[k] for k in RES}
        rows.append({"date": d, "u": u, "c": c, "total": sum(c.values()),
                     "kind": "факт" if d < today else "сегодня" if d == today else "прогноз"})
    return {"rows": rows, "today": today, "frac": frac, "dim": dim}


ENERGY_CLASSES = [(3.0, "A", "Отличный"), (3.8, "B", "Хороший"),
                  (4.6, "C", "Средний"), (99, "D", "Повышенный расход")]


def analytics_payload(apt):
    m = month_model(apt)
    rows, today, frac = m["rows"], m["today"], m["frac"]
    forecast = sum(r["total"] for r in rows)
    split = {"Вода": sum(r["c"]["cold"] + r["c"]["hot"] for r in rows),
             "Свет": sum(r["c"]["power"] for r in rows),
             "Отопление": sum(r["c"]["heat"] for r in rows)}
    cum, fact, fore, spent = 0, [], [], 0
    for r in rows:
        d = r["date"]
        cum += r["total"]
        if d < today:
            fact.append(round(cum))
            fore.append(round(cum) if d == today - timedelta(days=1) else None)
        elif d == today:
            spent = cum - r["total"] * (1 - frac)
            fact.append(round(spent))
            fore.append(round(cum))
        else:
            fact.append(None)
            fore.append(round(cum))
    kwh_m2 = sum(r["u"]["power"] for r in rows) / apt["area"]
    eclass, elabel = next((c, l) for lim, c, l in ENERGY_CLASSES if kwh_m2 < lim)

    # Сравнение с нормой (спокойный день без отклонений)
    norm = sum(sum(usage(apt, r["date"], k=1.0)[k] * TARIFF[k] for k in RES) for r in rows)
    diff = (forecast - norm) / norm * 100
    alerts = [SENSOR_NAMES[r["type"]] for r in db().execute(
        """SELECT s.type, (SELECT value FROM readings WHERE sensor_id=s.id ORDER BY id DESC LIMIT 1) AS v
           FROM sensors s WHERE apartment_id=?""", (apt["id"],)) if r["v"] and r["type"] in ("leak", "smoke")]
    top, top_val = max(split.items(), key=lambda kv: kv[1])
    share = top_val / forecast * 100
    if alerts:
        hint = f"Сработал датчик: {', '.join(alerts).lower()}. Проверьте квартиру."
    elif abs(diff) < 3:
        hint = f"Расходы в пределах нормы для квартиры {apt['area']:g} м². Лишних скачков нет."
    elif diff > 0:
        hint = f"Прогноз на {diff:.0f}% выше нормы. Больше всего уходит на {top.lower()} — {share:.0f}% затрат."
    else:
        hint = f"Прогноз на {abs(diff):.0f}% ниже нормы. Больше всего уходит на {top.lower()} — {share:.0f}% затрат."
    return {"forecast_total": round(forecast), "spent_now": round(spent),
            "split": {k: round(v) for k, v in split.items()},
            "labels": [r["date"].day for r in rows], "fact": fact, "forecast": fore,
            "energy_class": eclass, "energy_label": elabel, "hint": hint,
            "alert": bool(alerts), "updated": datetime.now().strftime("%H:%M:%S")}


# ---------- Страницы и авторизация ----------
@app.route("/")
def index():
    """Публичная главная; авторизованных отправляем в кабинет."""
    if "user_id" in session:
        return redirect(url_for("dashboard"))
    return render_template("landing.html")


@app.route("/terms")
def terms():
    """Пользовательское соглашение (демонстрационное)."""
    return render_template("terms.html")


@app.route("/privacy")
def privacy():
    """Политика конфиденциальности (демонстрационная)."""
    return render_template("privacy.html")


@app.route("/calculator")
def calculator():
    """Публичный калькулятор установки с редактором планировки (без авторизации)."""
    return render_template("calculator.html")


@app.route("/register", methods=["GET", "POST"])
def register():
    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        pw, pw2 = request.form.get("password", ""), request.form.get("password2", "")
        if not 3 <= len(username) <= 32:
            error = "Логин — от 3 до 32 символов."
        elif len(pw) < 6:
            error = "Пароль должен быть не короче 6 символов."
        elif pw != pw2:
            error = "Пароли не совпадают."
        elif db().execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
            error = "Этот логин уже занят."
        else:
            cur = db().execute("INSERT INTO users(username, password_hash) VALUES(?,?)",
                               (username, generate_password_hash(pw)))
            create_apartment(cur.lastrowid, "Моя квартира", 54, 2)
            db().commit()
            session.clear()
            session.update(user_id=cur.lastrowid, username=username)
            return redirect(url_for("dashboard"))
    return render_template("register.html", error=error)


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        user = db().execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        if user and check_password_hash(user["password_hash"], request.form.get("password", "")):
            session.clear()
            session.update(user_id=user["id"], username=user["username"])
            return redirect(url_for("dashboard"))
        error = "Неверный логин или пароль."
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("dashboard.html")


# ---------- API: квартиры ----------
@app.route("/api/apartments", methods=["GET", "POST"])
@login_required
def apartments():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        name = str(data.get("name", "")).strip()[:60]
        try:
            area, residents = float(data.get("area", 54)), int(data.get("residents", 2))
        except (TypeError, ValueError):
            return jsonify(error="Проверьте площадь и число жильцов."), 400
        if not name or not 10 <= area <= 500 or not 1 <= residents <= 10:
            return jsonify(error="Нужны название, площадь 10–500 м² и 1–10 жильцов."), 400
        apt_id = create_apartment(session["user_id"], name, area, residents)
        db().commit()
        return jsonify(apt_dict(get_apartment(apt_id))), 201
    rows = db().execute("SELECT * FROM apartments WHERE user_id=? ORDER BY id", (session["user_id"],))
    return jsonify([apt_dict(r) for r in rows])


@app.route("/api/apartments/<int:apt_id>/layout", methods=["POST"])
@login_required
def upload_layout(apt_id):
    get_apartment(apt_id)
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify(error="Выберите файл."), 400
    head = f.stream.read(8)
    f.stream.seek(0)
    if head.startswith(b"\x89PNG"):
        ext = "png"
    elif head.startswith(b"\xff\xd8"):
        ext = "jpg"
    else:
        return jsonify(error="Подходят только изображения JPG и PNG."), 400
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    name = f"plan_{apt_id}_{int(datetime.now().timestamp())}.{ext}"
    f.save(os.path.join(UPLOAD_DIR, name))
    url = f"/static/uploads/{name}"
    db().execute("UPDATE apartments SET layout_image_url=? WHERE id=?", (url, apt_id))
    db().commit()
    return jsonify(url=url)


# ---------- API: датчики ----------
def coord(v):
    return max(0.0, min(100.0, float(v)))


@app.route("/api/apartments/<int:apt_id>/sensors", methods=["GET", "POST"])
@login_required
def sensors(apt_id):
    get_apartment(apt_id)
    conn = db()
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        stype = data.get("type")
        if stype not in SENSOR_TYPES:
            return jsonify(error="Неизвестный тип датчика."), 400
        try:
            x, y = coord(data["x"]), coord(data["y"])
        except (KeyError, TypeError, ValueError):
            return jsonify(error="Некорректные координаты."), 400
        cur = conn.execute("INSERT INTO sensors(apartment_id, type, x_coord, y_coord) VALUES(?,?,?,?)",
                           (apt_id, stype, x, y))
        add_reading(cur.lastrowid, stype)
        conn.commit()
        return jsonify(sensor_dict(cur.lastrowid)), 201
    # Каждый запрос — новый «замер» телеметрии
    for s in [dict(r) for r in conn.execute("SELECT id, type FROM sensors WHERE apartment_id=?", (apt_id,))]:
        prev = conn.execute("SELECT value FROM readings WHERE sensor_id=? ORDER BY id DESC LIMIT 1",
                            (s["id"],)).fetchone()
        add_reading(s["id"], s["type"], prev["value"] if prev else None)
    conn.commit()
    ids = [r["id"] for r in conn.execute("SELECT id FROM sensors WHERE apartment_id=? ORDER BY id", (apt_id,))]
    return jsonify([sensor_dict(i) for i in ids])


@app.route("/api/sensors/<int:sid>", methods=["PATCH", "DELETE"])
@login_required
def sensor_item(sid):
    get_sensor(sid)
    if request.method == "DELETE":
        db().execute("DELETE FROM sensors WHERE id=?", (sid,))
        db().commit()
        return jsonify(ok=True)
    data = request.get_json(silent=True) or {}
    try:
        x, y = coord(data["x"]), coord(data["y"])
    except (KeyError, TypeError, ValueError):
        return jsonify(error="Некорректные координаты."), 400
    db().execute("UPDATE sensors SET x_coord=?, y_coord=? WHERE id=?", (x, y, sid))
    db().commit()
    return jsonify(sensor_dict(sid))


@app.route("/api/sensors/<int:sid>/history")
@login_required
def sensor_history(sid):
    get_sensor(sid)
    rows = db().execute("SELECT value, timestamp FROM readings WHERE sensor_id=? ORDER BY id DESC LIMIT 30",
                        (sid,)).fetchall()[::-1]
    return jsonify(values=[r["value"] for r in rows], times=[r["timestamp"][11:] for r in rows])


@app.route("/api/sensors/<int:sid>/alarm", methods=["POST"])
@login_required
def sensor_alarm(sid):
    s = get_sensor(sid)
    if s["type"] not in ("leak", "smoke"):
        return jsonify(error="Проверка тревоги есть только у датчиков дыма и протечки."), 400
    add_reading(sid, s["type"], value=1)
    db().commit()
    return jsonify(sensor_dict(sid))


# ---------- API: аналитика и отчёт ----------
@app.route("/api/apartments/<int:apt_id>/analytics")
@login_required
def analytics(apt_id):
    return jsonify(analytics_payload(get_apartment(apt_id)))


@app.route("/api/apartments/<int:apt_id>/report.csv")
@login_required
def report(apt_id):
    apt = get_apartment(apt_id)
    m = month_model(apt)
    ru = lambda x, nd=2: f"{x:.{nd}f}".replace(".", ",")
    out = io.StringIO()
    w = csv.writer(out, delimiter=";")
    w.writerow([f"КвартМетр — детализация расходов: {apt['name']}"])
    w.writerow(["Период", f"{m['today']:%m.%Y}", "Площадь, м²", ru(apt["area"], 1), "Проживает, чел.", apt["residents"]])
    w.writerow(["Тарифы", f"ХВС {ru(TARIFF['cold'])} ₽/м³", f"ГВС {ru(TARIFF['hot'])} ₽/м³",
                f"Электричество {ru(TARIFF['power'])} ₽/кВт·ч", f"Отопление {ru(TARIFF['heat'])} ₽/Гкал"])
    w.writerow([])
    w.writerow(["Дата", "Статус", "ХВС, м³", "ГВС, м³", "Электричество, кВт·ч", "Отопление, Гкал",
                "ХВС, ₽", "ГВС, ₽", "Электричество, ₽", "Отопление, ₽", "Итого, ₽"])
    for r in m["rows"]:
        u, c = r["u"], r["c"]
        w.writerow([f"{r['date']:%d.%m.%Y}", r["kind"], ru(u["cold"], 3), ru(u["hot"], 3), ru(u["power"]),
                    ru(u["heat"], 4), ru(c["cold"]), ru(c["hot"]), ru(c["power"]), ru(c["heat"]), ru(r["total"])])
    tot = {k: sum(r["c"][k] for r in m["rows"]) for k in RES}
    w.writerow(["Итого за месяц (прогноз)", "", "", "", "", "", ru(tot["cold"]), ru(tot["hot"]),
                ru(tot["power"]), ru(tot["heat"]), ru(sum(tot.values()))])
    return Response("\ufeff" + out.getvalue(), mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f"attachment; filename=kvartmetr_{apt_id}_{m['today']:%Y-%m}.csv"})


init_db()

if __name__ == "__main__":
    app.run(debug=True)
