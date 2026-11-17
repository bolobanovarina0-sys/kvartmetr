/* КвартМетр — конструктор планировки (Konva.js) и калькулятор стоимости */
(() => {
  const EDITOR_VERSION = "3.0";

  // Если библиотека Konva не загрузилась, а ошибки молчат, кнопки «не работают». Показываем причину на странице
  const showError = (msg) => {
    const el = document.getElementById("ed-alert");
    if (el) { el.textContent = msg; el.hidden = false; }
  };
  if (typeof Konva === "undefined") {
    showError("Не загрузилась библиотека Konva.js (cdnjs и jsdelivr недоступны). Проверьте интернет или блокировщик и обновите страницу.");
    return;
  }
  window.addEventListener("error", (e) => showError(`Ошибка в редакторе: ${e.message}`));

  const W = 800, H = 520;   // логический размер холста, px
  const M = 50;             // масштаб: 1 метр = 50 пикселей

  const PRICES = { hub: 3500, install: 2000, temperature: 1500, leak: 1200, smoke: 1800, electricity: 1500 };
  const NAMES = { hub: "Центральный хаб", temperature: "Датчик температуры", leak: "Датчик протечки",
                  smoke: "Датчик дыма", electricity: "Датчик электричества" };
  const COLORS = { hub: "#111827", temperature: "#F59E0B", leak: "#0EA5E9", smoke: "#EF4444", electricity: "#8B5CF6" };
  const SENSOR_KEYS = ["temperature", "leak", "smoke", "electricity"];
  const DISCOUNT_OVER = 10, DISCOUNT = 0.1;
  const ICONS = {
    hub: "M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01",
    temperature: "M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z",
    leak: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11zM9 14a3 3 0 0 0 3 3",
    smoke: "M7 17a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 8.5A3.75 3.75 0 0 1 17.5 17zM8 21h8",
    electricity: "M13 2L4 14h7l-1 8l9-12h-7z",
  };
  const FURNITURE_KINDS = ["bed", "sofa", "table", "counter", "fridge", "stove", "sink", "wc", "bathtub", "basin", "washer", "wardrobe"];
  const WALL_OUTER = "#334155";   // несущие (внешние) стены, 10 px
  const WALL_INNER = "#64748B";   // перегородки, 6 px
  const wallColor = (t) => (t >= 8 ? WALL_OUTER : WALL_INNER);
  const ROOM_TINTS = ["rgba(37,99,235,.07)", "rgba(16,185,129,.07)", "rgba(245,158,11,.09)", "rgba(139,92,246,.07)"];
  const SNAP = 14;          // радиус «прилипания» датчика к стене, px
  const ROTATABLE = ["door", "window", "furniture"];
  let drawMode = false, drawing = null, origin = null;   // режим рисования комнат мышью

  // <PRESETS-BEGIN>
  /* ---------- Готовые планировки ----------
     Координаты комнат и стен записаны в метрах (потом умножаются на M = 50 px/м).
     door(x, y, dir, swing, ширина, толщина стены): x,y — петля двери; dir — куда идёт проём вдоль стены
     (r — вправо, d — вниз, l — влево, u — вверх); swing — в какую сторону открывается полотно.
     win(x1, y1, x2, y2): окно вдоль стены. F(тип, x, y, w, h, поворот): мебель по левому верхнему углу.
     S(тип, x, y): датчик. Внешние стены 10 px, перегородки 6 px. */
  const DIRS = { r: [1, 0], d: [0, 1], l: [-1, 0], u: [0, -1] };
  const door = (hx, hy, dir, swing, w = 0.8, t = 6) => {
    const d = DIRS[dir], s = DIRS[swing];
    const rot = Math.round((Math.atan2(d[1], d[0]) * 180) / Math.PI);
    const th = (rot * Math.PI) / 180;
    const normal = [-Math.sin(th), Math.cos(th)];          // локальная ось «вниз» после поворота
    return { x: hx * M, y: hy * M, width: w * M, rotation: (rot + 360) % 360,
             flip: normal[0] * s[0] + normal[1] * s[1] < 0, thickness: t };
  };
  const win = (x1, y1, x2, y2, t = 10) => ({
    x: x1 * M, y: y1 * M, length: Math.hypot(x2 - x1, y2 - y1) * M,
    rotation: (Math.round((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI) + 360) % 360, thickness: t });
  const F = (kind, x, y, w, h, rot = 0) => ({ kind, x: (x + w / 2) * M, y: (y + h / 2) * M, width: w * M, height: h * M, rotation: rot });
  const S = (type, x, y) => ({ type, x: x * M, y: y * M });

  const PRESETS = {
    // Студия ~32 м²: Г-образная жилая зона, ниша прихожей, санузел в углу
    studio: {
      rooms: [["Студия", [0, 0, 6, 0, 6, 2.4, 4.1, 2.4, 4.1, 4.2, 0, 4.2]],
              ["Санузел", [4.1, 2.4, 6, 2.4, 6, 4.2, 4.1, 4.2]],
              ["Прихожая", [0, 4.2, 2.6, 4.2, 2.6, 5.4, 0, 5.4]]],
      walls: [{ p: [0, 0, 6, 0, 6, 4.2, 2.6, 4.2, 2.6, 5.4, 0, 5.4], c: 1, t: 10 },
              { p: [4.1, 4.2, 4.1, 2.4, 6, 2.4] }],
      doors: [door(4.1, 3.9, "u", "r", 0.8), door(0.9, 5.4, "r", "u", 0.9, 10)],
      windows: [win(1.0, 0, 2.4, 0), win(3.4, 0, 5.0, 0), win(6, 0.5, 6, 1.8), win(0, 0.8, 0, 2.0)],
      furniture: [F("counter", 0.15, 0.15, 0.6, 2.4), F("fridge", 0.15, 0.15, 0.6, 0.7), F("stove", 0.15, 1.05, 0.6, 0.6),
                  F("sink", 0.15, 1.75, 0.6, 0.7), F("table", 1.3, 0.5, 1.1, 0.8), F("bed", 4.2, 0.2, 1.6, 2.0),
                  F("sofa", 1.0, 3.05, 2.0, 0.9), F("wardrobe", 1.9, 4.35, 0.6, 0.95),
                  F("bathtub", 4.25, 2.55, 1.65, 0.6), F("wc", 5.4, 3.45, 0.45, 0.6, 180), F("basin", 4.95, 3.75, 0.35, 0.4)],
      sensors: [S("temperature", 3.2, 3.4), S("smoke", 3.3, 1.2), S("electricity", 0.45, 2.95), S("leak", 5.0, 2.85), S("hub", 0.45, 4.8)],
    },
    // 1-комнатная ~52 м²: эркер у комнаты, Г-образная прихожая, гардеробная
    one: {
      rooms: [["Комната", [0, 0.7, 1.4, 0.7, 1.4, 0, 3.6, 0, 3.6, 0.7, 5.0, 0.7, 5.0, 4.6, 0, 4.6]],
              ["Кухня", [5.0, 0.7, 8.4, 0.7, 8.4, 3.8, 5.0, 3.8]],
              ["Санузел", [6.6, 3.8, 8.4, 3.8, 8.4, 6.9, 6.6, 6.9]],
              ["Прихожая", [5.0, 3.8, 6.6, 3.8, 6.6, 6.9, 2.4, 6.9, 2.4, 4.6, 5.0, 4.6]],
              ["Гардеробная", [0, 4.6, 2.4, 4.6, 2.4, 6.9, 0, 6.9]]],
      walls: [{ p: [0, 0.7, 1.4, 0.7, 1.4, 0, 3.6, 0, 3.6, 0.7, 8.4, 0.7, 8.4, 6.9, 0, 6.9], c: 1, t: 10 },
              { p: [5.0, 0.7, 5.0, 4.6] }, { p: [0, 4.6, 5.0, 4.6] }, { p: [5.0, 3.8, 8.4, 3.8] },
              { p: [6.6, 3.8, 6.6, 6.9] }, { p: [2.4, 4.6, 2.4, 6.9] }],
      doors: [door(3.2, 6.9, "r", "u", 0.9, 10), door(3.0, 4.6, "r", "d", 0.9), door(0.7, 4.6, "r", "d", 0.8),
              door(5.0, 1.5, "d", "r", 0.9), door(5.5, 3.8, "r", "u", 0.8), door(6.6, 5.3, "d", "r", 0.8),
              door(2.4, 5.5, "d", "r", 0.8)],
      windows: [win(1.8, 0, 3.2, 0), win(0, 1.4, 0, 3.4), win(5.9, 0.7, 7.5, 0.7), win(8.4, 1.3, 8.4, 2.7)],
      furniture: [F("bed", 0.3, 0.95, 1.6, 2.0), F("sofa", 2.2, 2.9, 2.0, 0.9), F("table", 3.4, 1.0, 1.3, 0.7),
                  F("counter", 5.15, 0.85, 3.1, 0.6), F("fridge", 5.15, 0.85, 0.6, 0.7), F("stove", 6.2, 0.85, 0.6, 0.6),
                  F("sink", 7.0, 0.85, 0.7, 0.6), F("table", 6.7, 2.0, 1.4, 0.9),
                  F("bathtub", 6.75, 3.95, 1.55, 0.65), F("washer", 7.7, 4.75, 0.6, 0.6), F("basin", 7.9, 5.5, 0.4, 0.5),
                  F("wc", 7.85, 6.2, 0.45, 0.6, 180), F("wardrobe", 0.15, 5.0, 0.6, 1.8), F("wardrobe", 1.65, 5.0, 0.6, 0.8)],
      sensors: [S("temperature", 2.6, 1.9), S("smoke", 4.3, 2.3), S("smoke", 7.7, 3.3), S("electricity", 6.5, 1.3),
                S("leak", 7.1, 1.1), S("leak", 7.4, 4.28), S("hub", 4.0, 5.8)],
    },
    // 2-комнатная ~58 м²: Г-образная гостиная с нишей, эркер кухни, Г-образный коридор
    two: {
      rooms: [["Гостиная", [0, 0, 4.4, 0, 4.4, 3.8, 2.2, 3.8, 2.2, 4.6, 0, 4.6]],
              ["Спальня", [4.4, 0, 6.8, 0, 6.8, 3.8, 4.4, 3.8]],
              ["Кухня", [6.8, 0, 9.0, 0, 9.0, 1.5, 9.7, 1.5, 9.7, 3.1, 9.0, 3.1, 9.0, 3.8, 6.8, 3.8]],
              ["Прихожая", [2.2, 3.8, 9.0, 3.8, 9.0, 4.8, 4.4, 4.8, 4.4, 6.8, 2.2, 6.8]],
              ["Гардеробная", [0, 4.6, 2.2, 4.6, 2.2, 6.8, 0, 6.8]],
              ["Кладовая", [4.4, 4.8, 6.4, 4.8, 6.4, 6.8, 4.4, 6.8]],
              ["Санузел", [6.4, 4.8, 9.0, 4.8, 9.0, 6.8, 6.4, 6.8]]],
      walls: [{ p: [0, 0, 9.0, 0, 9.0, 1.5, 9.7, 1.5, 9.7, 3.1, 9.0, 3.1, 9.0, 6.8, 0, 6.8], c: 1, t: 10 },
              { p: [4.4, 0, 4.4, 3.8] }, { p: [6.8, 0, 6.8, 3.8] }, { p: [0, 4.6, 2.2, 4.6, 2.2, 3.8, 9.0, 3.8] },
              { p: [2.2, 4.6, 2.2, 6.8] }, { p: [9.0, 4.8, 4.4, 4.8, 4.4, 6.8] }, { p: [6.4, 4.8, 6.4, 6.8] }],
      doors: [door(2.7, 6.8, "r", "u", 0.9, 10), door(3.0, 3.8, "r", "d", 0.8), door(5.2, 3.8, "r", "u", 0.8),
              door(7.4, 3.8, "r", "u", 0.8), door(7.4, 4.8, "r", "d", 0.8), door(4.7, 4.8, "r", "d", 0.8),
              door(2.2, 5.4, "d", "l", 0.8)],
      windows: [win(0.8, 0, 2.2, 0), win(2.8, 0, 3.8, 0), win(5.2, 0, 6.0, 0), win(7.4, 0, 8.6, 0),
                win(9.7, 1.9, 9.7, 2.7), win(0, 1.0, 0, 2.6)],
      furniture: [F("sofa", 2.0, 2.7, 2.0, 0.9), F("table", 0.3, 3.2, 1.5, 0.9), F("table", 2.9, 0.4, 1.2, 0.7),
                  F("bed", 4.95, 0.2, 1.6, 2.0), F("wardrobe", 4.55, 2.55, 0.55, 1.1),
                  F("counter", 6.95, 0.15, 1.9, 0.6), F("fridge", 6.95, 0.15, 0.6, 0.7), F("stove", 7.7, 0.15, 0.6, 0.6),
                  F("sink", 8.3, 0.15, 0.55, 0.6), F("table", 8.2, 1.8, 1.3, 0.9),
                  F("bathtub", 6.6, 6.1, 1.7, 0.6), F("wc", 8.475, 5.2, 0.45, 0.6, 90), F("basin", 6.5, 5.0, 0.5, 0.4),
                  F("washer", 6.5, 5.5, 0.6, 0.55), F("wardrobe", 5.7, 5.2, 0.6, 1.5), F("wardrobe", 0.15, 4.8, 0.6, 1.9)],
      sensors: [S("temperature", 3.0, 1.5), S("smoke", 2.1, 0.9), S("temperature", 5.7, 1.2), S("smoke", 6.5, 2.9),
                S("electricity", 7.3, 1.2), S("smoke", 8.0, 2.6), S("leak", 8.6, 0.5), S("leak", 7.5, 6.4), S("hub", 3.3, 5.6)],
    },
    // 3-комнатная ~74 м²: Г-образная гостиная, эркер кухни, детская, гардеробная
    three: {
      rooms: [["Гостиная", [0, 0, 4.8, 0, 4.8, 3.8, 2.4, 3.8, 2.4, 4.6, 0, 4.6]],
              ["Спальня", [4.8, 0, 7.6, 0, 7.6, 3.8, 4.8, 3.8]],
              ["Кухня", [7.6, 0, 10.4, 0, 10.4, 1.6, 11.1, 1.6, 11.1, 3.2, 10.4, 3.2, 10.4, 3.8, 7.6, 3.8]],
              ["Прихожая", [2.4, 3.8, 10.4, 3.8, 10.4, 4.8, 4.8, 4.8, 4.8, 7.0, 2.4, 7.0]],
              ["Гардеробная", [0, 4.6, 2.4, 4.6, 2.4, 7.0, 0, 7.0]],
              ["Санузел", [4.8, 4.8, 6.6, 4.8, 6.6, 7.0, 4.8, 7.0]],
              ["Детская", [6.6, 4.8, 10.4, 4.8, 10.4, 7.0, 6.6, 7.0]]],
      walls: [{ p: [0, 0, 10.4, 0, 10.4, 1.6, 11.1, 1.6, 11.1, 3.2, 10.4, 3.2, 10.4, 7.0, 0, 7.0], c: 1, t: 10 },
              { p: [4.8, 0, 4.8, 3.8] }, { p: [7.6, 0, 7.6, 3.8] }, { p: [0, 4.6, 2.4, 4.6, 2.4, 3.8, 10.4, 3.8] },
              { p: [2.4, 4.6, 2.4, 7.0] }, { p: [10.4, 4.8, 4.8, 4.8, 4.8, 7.0] }, { p: [6.6, 4.8, 6.6, 7.0] }],
      doors: [door(2.9, 7.0, "r", "u", 0.9, 10), door(3.2, 3.8, "r", "d", 0.8), door(5.6, 3.8, "r", "u", 0.8),
              door(8.2, 3.8, "r", "u", 0.8), door(5.7, 4.8, "r", "d", 0.8), door(7.4, 4.8, "r", "d", 0.8),
              door(2.4, 5.6, "d", "l", 0.8)],
      windows: [win(0.8, 0, 2.4, 0), win(3.0, 0, 4.2, 0), win(5.4, 0, 6.8, 0), win(8.2, 0, 9.6, 0),
                win(11.1, 1.9, 11.1, 2.9), win(0, 1.0, 0, 2.8), win(7.4, 7.0, 9.4, 7.0)],
      furniture: [F("sofa", 2.4, 2.7, 2.2, 0.9), F("table", 0.3, 3.2, 1.6, 0.9), F("table", 3.2, 0.4, 1.2, 0.7),
                  F("bed", 5.4, 0.2, 1.6, 2.0), F("wardrobe", 4.95, 2.5, 0.55, 1.1),
                  F("counter", 7.75, 0.15, 2.5, 0.6), F("fridge", 7.75, 0.15, 0.6, 0.7), F("stove", 8.9, 0.15, 0.6, 0.6),
                  F("sink", 9.6, 0.15, 0.6, 0.6), F("table", 9.0, 2.0, 1.3, 0.9),
                  F("bathtub", 4.95, 6.3, 1.5, 0.6), F("basin", 4.95, 5.0, 0.55, 0.4), F("wc", 6.075, 5.6, 0.45, 0.6, 90),
                  F("bed", 9.4, 4.95, 0.9, 1.9), F("table", 6.8, 6.3, 1.4, 0.6), F("wardrobe", 6.75, 5.2, 0.6, 0.9),
                  F("wardrobe", 0.15, 4.8, 0.6, 2.0)],
      sensors: [S("temperature", 3.4, 1.8), S("temperature", 6.2, 1.4), S("temperature", 8.4, 5.9), S("smoke", 2.2, 1.0),
                S("smoke", 7.0, 0.8), S("smoke", 8.8, 1.4), S("smoke", 9.6, 5.8), S("electricity", 8.3, 1.0),
                S("electricity", 3.0, 3.2), S("leak", 9.9, 0.5), S("leak", 5.7, 6.55), S("hub", 3.6, 5.6)],
    },
  };

  // Переводит описание пресета в тот же формат, что и JSON-шаблон, и центрирует план на холсте
  function makePlan(def) {
    const px = (a) => a.map((v) => v * M);
    const walls = def.walls.map((w) => ({ points: px(w.p), closed: !!w.c, thickness: w.t || 6 }));
    const xs = [], ys = [];
    walls.forEach((w) => w.points.forEach((v, i) => (i % 2 ? ys : xs).push(v)));
    const dx = Math.round((W - (Math.max(...xs) - Math.min(...xs))) / 2 - Math.min(...xs));
    const dy = Math.round((H - (Math.max(...ys) - Math.min(...ys))) / 2 - Math.min(...ys));
    const shift = (a) => a.map((v, i) => v + (i % 2 ? dy : dx));
    const move = (o) => ({ ...o, x: o.x + dx, y: o.y + dy });
    return {
      app: "kvartmetr", version: 2, scale: M, background: null,
      rooms: def.rooms.map(([name, p]) => ({ kind: "poly", name, points: shift(px(p)) })),
      walls: walls.map((w) => ({ ...w, points: shift(w.points) })),
      doors: def.doors.map(move), windows: def.windows.map(move),
      furniture: def.furniture.map(move), sensors: def.sensors.map(move),
    };
  }
  // <PRESETS-END>

  const $ = (s) => document.querySelector(s);
  const money = (v) => `${Math.round(v).toLocaleString("ru-RU")} ₽`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const getScale = () => parseFloat($("#scale").value) || 0;
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const isNum = (...v) => v.every((x) => typeof x === "number" && Number.isFinite(x));
  const r1 = (v) => Math.round(v * 10) / 10;
  const setStatus = (msg) => { $("#ed-status").textContent = msg; };
  const readText = (file) => new Promise((resolve, reject) => {     // FileReader работает и в старых браузерах
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error("не удалось прочитать файл"));
    r.readAsText(file);
  });
  const readDataUrl = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error("не удалось прочитать файл"));
    r.readAsDataURL(file);
  });

  /* ---------- Холст и слои ---------- */
  const wrap = $("#stage-wrap");
  const stage = new Konva.Stage({ container: "stage", width: W, height: H });
  const gridLayer = new Konva.Layer({ listening: false });
  const bgLayer = new Konva.Layer({ listening: false });
  const planLayer = new Konva.Layer();        // комнаты, стены, окна/двери, мебель, подписи
  const sensorLayer = new Konva.Layer();      // датчики — всегда поверх стен и комнат
  const uiLayer = new Konva.Layer();
  const gRooms = new Konva.Group();
  const gWalls = new Konva.Group();
  const gOpen = new Konva.Group();            // окна и двери
  const gFurn = new Konva.Group();
  const gLabels = new Konva.Group({ listening: false });
  planLayer.add(gRooms, gWalls, gOpen, gFurn, gLabels);
  stage.add(gridLayer, bgLayer, planLayer, sensorLayer, uiLayer);

  gridLayer.add(new Konva.Rect({ width: W, height: H, fill: "#FFFFFF" }));
  for (let x = 0; x <= W; x += M) gridLayer.add(new Konva.Line({ points: [x, 0, x, H], stroke: "#F8FAFC", strokeWidth: 1 }));
  for (let y = 0; y <= H; y += M) gridLayer.add(new Konva.Line({ points: [0, y, W, y], stroke: "#F8FAFC", strokeWidth: 1 }));

  const tr = new Konva.Transformer({
    rotateEnabled: false, flipEnabled: false, keepRatio: false, resizeEnabled: false,
    borderStroke: "#2563EB", anchorStroke: "#2563EB", anchorFill: "#FFFFFF", anchorSize: 9, anchorCornerRadius: 2,
    boundBoxFunc: (oldBox, newBox) => (newBox.width < 30 || newBox.height < 30 ? oldBox : newBox),
  });
  uiLayer.add(tr);

  // Холст подстраивается под ширину контейнера; внутри всегда координаты 800×520
  function fit() {
    const k = wrap.clientWidth / W;
    if (!k) return;
    stage.size({ width: W * k, height: H * k });
    stage.scale({ x: k, y: k });
  }
  new ResizeObserver(fit).observe(wrap);
  fit();

  /* ---------- Геометрия ---------- */
  const absPts = (n) => n.points().map((v, i) => v + (i % 2 ? n.y() : n.x()));
  function polyArea(p) {
    let a = 0;
    for (let i = 0; i < p.length / 2; i++) {
      const j = (i + 1) % (p.length / 2);
      a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
    }
    return Math.abs(a) / 2;
  }
  function polyCentroid(p) {
    let a = 0, cx = 0, cy = 0;
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, f = p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
      a += f; cx += (p[2 * i] + p[2 * j]) * f; cy += (p[2 * i + 1] + p[2 * j + 1]) * f;
    }
    if (Math.abs(a) < 1e-6) {
      const xs = p.filter((_, i) => i % 2 === 0), ys = p.filter((_, i) => i % 2 === 1);
      return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    }
    return [cx / (3 * a), cy / (3 * a)];
  }

  /* ---------- Выбор, удаление, поворот ---------- */
  let selected = null;

  function select(node) {
    if (selected && selected.name() === "sensor") selected.findOne("Circle").stroke("#FFFFFF").strokeWidth(2);
    selected = node;
    const isSensor = !!node && node.name() === "sensor";
    tr.nodes(node && !isSensor ? [node] : []);
    tr.resizeEnabled(!!node && node.name() === "room" && node instanceof Konva.Rect);
    if (isSensor) node.findOne("Circle").stroke("#111827").strokeWidth(3);
    if (node && node.name() === "room") $("#room-name").value = node.getAttr("roomName");
    $("#delete").disabled = !node;
    $("#rotate").disabled = !(node && ROTATABLE.includes(node.name()));
    sensorLayer.batchDraw();
    uiLayer.batchDraw();
  }

  function removeSelected() {
    if (!selected) return;
    if (selected._label) selected._label.destroy();
    selected.destroy();
    stage.container().style.cursor = "";
    tr.nodes([]);
    selected = null;
    $("#delete").disabled = true;
    $("#rotate").disabled = true;
    planLayer.batchDraw(); sensorLayer.batchDraw(); uiLayer.batchDraw();
    updateSummary();
  }

  $("#delete").addEventListener("click", removeSelected);
  $("#rotate").addEventListener("click", () => {
    if (!selected || !ROTATABLE.includes(selected.name())) return;
    selected.rotation((selected.rotation() + 90) % 360);
    tr.forceUpdate();
    planLayer.batchDraw(); uiLayer.batchDraw();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Delete" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) removeSelected();
  });

  // Общая «проводка» интерактивного элемента: выбор по клику и курсор (grab — можно тащить, pointer — только выбрать)
  function bindItem(node, cursor) {
    node.on("click tap", () => select(node));
    node.on("mouseenter", () => { if (!drawMode) stage.container().style.cursor = cursor; });
    node.on("mouseleave", () => { if (!drawMode) stage.container().style.cursor = ""; });
    if (node.draggable()) {
      node.on("dragstart", () => { select(node); stage.container().style.cursor = "grabbing"; });
      node.on("dragend", () => { stage.container().style.cursor = cursor; });
    }
  }

  /* ---------- Комнаты ---------- */
  function attachLabel(room) {
    room._label = new Konva.Text({ fontSize: 13, fontFamily: "Inter, sans-serif", fontStyle: "600", fill: "#1E3A8A",
                                   stroke: "#FFFFFF", strokeWidth: 3, fillAfterStrokeEnabled: true, lineJoin: "round",
                                   align: "center", lineHeight: 1.3, wrap: "none", listening: false });
    gLabels.add(room._label);
  }

  function roomArea(room, s) {
    if (room instanceof Konva.Rect) return (room.width() / s) * (room.height() / s);
    return polyArea(absPts(room)) / (s * s);
  }

  function updateLabel(room) {
    const t = room._label, s = getScale();
    let cx, cy, w;
    if (room instanceof Konva.Rect) { cx = room.x() + room.width() / 2; cy = room.y() + room.height() / 2; w = room.width(); }
    else { [cx, cy] = polyCentroid(absPts(room)); w = 160; }
    const area = s > 0 ? roomArea(room, s) : null;
    t.text([room.getAttr("roomName"), area !== null ? `${area.toFixed(1).replace(".", ",")} м²` : ""].filter(Boolean).join("\n"));
    t.width(w);
    t.x(cx - w / 2);
    t.y(cy - t.height() / 2);
    planLayer.batchDraw();
  }

  // Прямоугольная комната (рисуется мышью, меняет размер за рамку)
  function addRoom(x, y, w, h, name) {
    const room = new Konva.Rect({
      x, y, width: w, height: h, name: "room", roomName: name, draggable: true,
      fill: ROOM_TINTS[gRooms.getChildren().length % ROOM_TINTS.length], stroke: "#2563EB", strokeWidth: 2,
    });
    attachLabel(room);
    gRooms.add(room);
    bindItem(room, "grab");
    room.on("dragmove", () => updateLabel(room));
    room.on("transform", () => {                // «запекаем» растяжение в размеры, масштаб возвращаем к 1
      room.width(Math.max(30, room.width() * room.scaleX()));
      room.height(Math.max(30, room.height() * room.scaleY()));
      room.scale({ x: 1, y: 1 });
      updateLabel(room);
    });
    room.on("dragend transformend", updateSummary);
    updateLabel(room);
    return room;
  }

  // Комната произвольной формы (Г-образная, с нишами) — из пресетов и шаблонов
  function addPolyRoom(points, name) {
    const room = new Konva.Line({
      points, closed: true, name: "room", roomName: name,
      fill: ROOM_TINTS[gRooms.getChildren().length % ROOM_TINTS.length], stroke: "rgba(37,99,235,.35)", strokeWidth: 1,
    });
    attachLabel(room);
    gRooms.add(room);
    bindItem(room, "pointer");
    updateLabel(room);
    return room;
  }

  /* ---------- Стены, окна, двери ---------- */
  // Стена — Konva.Line. Несущие (>= 8 px) темнее и с тенью, перегородки светлее
  function addWall(points, closed, thickness) {
    const t = clamp(thickness, 2, 30), outer = t >= 8;
    const wall = new Konva.Line({
      points, closed, name: "wall", stroke: wallColor(t), strokeWidth: t, lineJoin: "miter", lineCap: "butt",
      hitStrokeWidth: Math.max(t, 14), draggable: true,
      shadowColor: "rgba(0,0,0,0.2)", shadowBlur: outer ? 4 : 2, shadowOffsetY: 1,
    });
    gWalls.add(wall);
    bindItem(wall, "grab");
    return wall;
  }

  // Окно: в стене «вырезается» разрыв, по краям две линии рамы и две линии стекла
  function addWindow(o) {
    const L = Math.max(10, o.length), t = clamp(o.thickness, 2, 30), col = wallColor(t);
    const g = new Konva.Group({ x: o.x, y: o.y, rotation: o.rotation, draggable: true, name: "window", wLen: L, wThick: t });
    g.add(new Konva.Rect({ x: 0, y: -t / 2 - 1, width: L, height: t + 2, fill: "#FFFFFF" }));
    [-t / 2, t / 2].forEach((y) => g.add(new Konva.Line({ points: [0, y, L, y], stroke: col, strokeWidth: 1.5 })));
    [-1.5, 1.5].forEach((y) => g.add(new Konva.Line({ points: [0, y, L, y], stroke: "#38BDF8", strokeWidth: 1.5 })));
    [0, L].forEach((x) => g.add(new Konva.Line({ points: [x, -t / 2, x, t / 2], stroke: col, strokeWidth: 2 })));
    gOpen.add(g);
    bindItem(g, "grab");
    return g;
  }

  // Дверь: разрыв в стене, косяки, открытое полотно и дуга открывания (Konva.Path, линии 2 px).
  // Петля в точке (x, y), проём идёт вдоль локальной оси X, полотно открывается на 90°
  function addDoor(o) {
    const w = Math.max(10, o.width), t = clamp(o.thickness, 2, 30), pad = (t + 2) / 2, col = wallColor(t);
    const g = new Konva.Group({ x: o.x, y: o.y, rotation: o.rotation, scaleY: o.flip ? -1 : 1, draggable: true,
                                name: "door", dFlip: !!o.flip, dWidth: w, dThick: t });
    g.add(new Konva.Rect({ x: 0, y: -pad, width: w, height: t + 2, fill: "#FFFFFF" }));
    g.add(new Konva.Line({ points: [0, -pad, 0, pad], stroke: col, strokeWidth: 2 }));
    g.add(new Konva.Line({ points: [w, -pad, w, pad], stroke: col, strokeWidth: 2 }));
    g.add(new Konva.Line({ points: [0, 0, 0, w], stroke: "#475569", strokeWidth: 2, lineCap: "round" }));
    g.add(new Konva.Path({ data: `M${w} 0 A${w} ${w} 0 0 1 0 ${w}`, stroke: "#64748B", strokeWidth: 2 }));
    gOpen.add(g);
    bindItem(g, "grab");
    return g;
  }

  /* ---------- Мебель ---------- */
  function furnitureShapes(kind, w, h) {
    const base = { stroke: "#CBD5E1", strokeWidth: 1.5, fill: "#F1F5F9" };
    const box = (o = {}) => new Konva.Rect({ x: 0, y: 0, width: w, height: h, cornerRadius: 4, ...base, ...o });
    const line = (pts) => new Konva.Line({ points: pts, stroke: "#94A3B8", strokeWidth: 1.2 });
    const m = Math.min(w, h);
    switch (kind) {
      case "bed": {
        const two = w > 60, pw = two ? w * 0.4 : w * 0.7;
        const pillow = (x) => new Konva.Rect({ x, y: h * 0.05, width: pw, height: h * 0.16, cornerRadius: 4, ...base, fill: "#FFFFFF" });
        return [box({ cornerRadius: 6 }), ...(two ? [pillow(w * 0.07), pillow(w * 0.53)] : [pillow(w * 0.15)]), line([0, h * 0.38, w, h * 0.38])];
      }
      case "sofa":
        return [box({ cornerRadius: 8 }), new Konva.Rect({ x: 0, y: 0, width: w, height: h * 0.28, cornerRadius: 6, ...base, fill: "#E2E8F0" }),
                line([w / 2, h * 0.28, w / 2, h])];
      case "table": return [box({ cornerRadius: 6, fill: "#F8FAFC" })];
      case "counter": return [box({ cornerRadius: 2, fill: "#F1F5F9" })];
      case "fridge": return [box({ fill: "#F8FAFC" }), line([0, h * 0.35, w, h * 0.35]), line([w * 0.8, h * 0.12, w * 0.8, h * 0.28])];
      case "stove":
        return [box(), ...[[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]].map(([fx, fy]) =>
          new Konva.Circle({ x: w * fx, y: h * fy, radius: m * 0.15, stroke: "#94A3B8", strokeWidth: 1.5 }))];
      case "sink":
        return [box(), new Konva.Rect({ x: w * 0.15, y: h * 0.2, width: w * 0.7, height: h * 0.62, cornerRadius: 4, stroke: "#94A3B8", strokeWidth: 1.2 }),
                new Konva.Circle({ x: w / 2, y: h * 0.1, radius: 2, fill: "#94A3B8" })];
      case "wc":
        return [new Konva.Rect({ x: w * 0.1, y: 0, width: w * 0.8, height: h * 0.28, cornerRadius: 3, ...base }),
                new Konva.Ellipse({ x: w / 2, y: h * 0.62, radiusX: w * 0.42, radiusY: h * 0.36, ...base })];
      case "bathtub":
        return [box({ cornerRadius: 8 }), new Konva.Rect({ x: w * 0.05, y: h * 0.14, width: w * 0.9, height: h * 0.72, cornerRadius: 10, stroke: "#94A3B8", strokeWidth: 1.2 }),
                new Konva.Circle({ x: w * 0.12, y: h / 2, radius: 3, fill: "#94A3B8" })];
      case "basin":
        return [box({ cornerRadius: 3 }), new Konva.Ellipse({ x: w / 2, y: h / 2, radiusX: w * 0.32, radiusY: h * 0.3, stroke: "#94A3B8", strokeWidth: 1.2 })];
      case "washer":
        return [box(), new Konva.Circle({ x: w / 2, y: h / 2, radius: m * 0.3, stroke: "#94A3B8", strokeWidth: 1.5 }),
                new Konva.Circle({ x: w / 2, y: h / 2, radius: m * 0.14, stroke: "#CBD5E1", strokeWidth: 1.2 })];
      case "wardrobe":
        return [box({ cornerRadius: 2, fill: "#F8FAFC" }), w >= h ? line([w / 2, 0, w / 2, h]) : line([0, h / 2, w, h / 2])];
      default: return [box()];
    }
  }

  // x, y — центр предмета: поворот идёт вокруг центра
  function addFurniture(o) {
    const g = new Konva.Group({ x: o.x, y: o.y, offsetX: o.width / 2, offsetY: o.height / 2, rotation: o.rotation || 0,
                                draggable: true, name: "furniture", fKind: o.kind, fW: o.width, fH: o.height });
    furnitureShapes(o.kind, o.width, o.height).forEach((s) => g.add(s));
    gFurn.add(g);
    bindItem(g, "grab");
    return g;
  }

  /* ---------- Датчики ---------- */
  function forEachSegment(cb) {
    gWalls.getChildren().forEach((w) => {
      const p = absPts(w), n = p.length / 2;
      for (let i = 0; i < n - 1; i++) cb(p[2 * i], p[2 * i + 1], p[2 * i + 2], p[2 * i + 3]);
      if (w.closed()) cb(p[2 * n - 2], p[2 * n - 1], p[0], p[1]);
    });
    gRooms.getChildren().forEach((r) => {
      if (!(r instanceof Konva.Rect)) return;
      const x = r.x(), y = r.y(), a = r.width(), b = r.height();
      cb(x, y, x + a, y); cb(x + a, y, x + a, y + b); cb(x + a, y + b, x, y + b); cb(x, y + b, x, y);
    });
  }

  // Если датчик отпущен рядом со стеной (или стороной нарисованной комнаты) — «прилипает» к ней
  function snapSensor(g) {
    let best = null;
    forEachSegment((x1, y1, x2, y2) => {
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      if (!l2) return;
      const t = clamp(((g.x() - x1) * dx + (g.y() - y1) * dy) / l2, 0, 1);
      const px = x1 + t * dx, py = y1 + t * dy, d = Math.hypot(g.x() - px, g.y() - py);
      if (d <= SNAP && (!best || d < best.d)) best = { x: px, y: py, d };
    });
    if (best) { g.position({ x: best.x, y: best.y }); sensorLayer.batchDraw(); }
  }

  function addSensor(type, x, y, snap = true) {
    const g = new Konva.Group({ x: clamp(x, 16, W - 16), y: clamp(y, 16, H - 16), name: "sensor", sType: type, draggable: true });
    g.add(new Konva.Circle({ radius: 17, fill: COLORS[type], stroke: "#FFFFFF", strokeWidth: 2,
                             shadowColor: "rgba(17,24,39,.35)", shadowBlur: 6, shadowOffsetY: 2 }));
    g.add(new Konva.Path({ data: ICONS[type], stroke: "#FFFFFF", strokeWidth: 2, lineCap: "round", lineJoin: "round",
                           x: -9, y: -9, scaleX: 0.75, scaleY: 0.75 }));
    bindItem(g, "grab");
    g.on("dragend", (e) => { if (!(e.evt && e.evt.altKey)) snapSensor(g); });   // Alt при отпускании — без прилипания
    sensorLayer.add(g);
    if (snap) snapSensor(g);
    sensorLayer.batchDraw();
    updateSummary();
    return g;
  }

  // Перетаскивание из панели на холст (и добавление по клику — для сенсорных экранов)
  document.querySelectorAll(".tool[data-type]").forEach((el) => {
    el.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", `sensor:${el.dataset.type}`); e.dataTransfer.effectAllowed = "copy"; });
    el.addEventListener("click", () => select(addSensor(el.dataset.type, W / 2 + (Math.random() - 0.5) * 120, H / 2 + (Math.random() - 0.5) * 120, false)));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") el.click(); });
  });
  wrap.addEventListener("dragover", (e) => e.preventDefault());
  wrap.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];     // файл, перетащенный с компьютера
    if (file) {
      if (/\.json$/i.test(file.name) || file.type === "application/json") handleTemplate(file); else handleImage(file);
      return;
    }
    const [kind, type] = (e.dataTransfer.getData("text/plain") || "").split(":");
    if (kind !== "sensor" || !has(ICONS, type)) return;
    stage.setPointersPositions(e);
    const p = stage.getRelativePointerPosition();
    select(addSensor(type, p.x, p.y, !e.altKey));
  });

  /* ---------- Рисование комнат мышью ---------- */
  const roomTitle = () => $("#room-name").value.trim() || "Комната";

  function setDraw(on) {
    drawMode = on;
    planLayer.listening(!on);        // в режиме рисования план «прозрачен» для мыши — можно рисовать поверх шаблона
    $("#draw").classList.toggle("active", on);
    $("#draw").textContent = on ? "Протяните по плану…" : "Нарисовать мышью";
    stage.container().style.cursor = on ? "crosshair" : "";
  }
  $("#draw").addEventListener("click", () => setDraw(!drawMode));

  stage.on("mousedown touchstart", (e) => {
    if (e.target !== stage) return;
    if (!drawMode) return select(null);
    origin = stage.getRelativePointerPosition();
    drawing = addRoom(origin.x, origin.y, 1, 1, roomTitle());
  });
  stage.on("mousemove touchmove", () => {
    if (!drawing) return;
    const p = stage.getRelativePointerPosition();
    drawing.position({ x: Math.min(origin.x, p.x), y: Math.min(origin.y, p.y) });
    drawing.size({ width: Math.abs(p.x - origin.x), height: Math.abs(p.y - origin.y) });
    updateLabel(drawing);
  });
  stage.on("mouseup touchend", () => {
    if (!drawing) return;
    const room = drawing;
    drawing = null;
    setDraw(false);
    if (room.width() < 30 || room.height() < 30) { room._label.destroy(); room.destroy(); planLayer.batchDraw(); }
    else select(room);
    updateSummary();
  });

  $("#add-room").addEventListener("click", () => {
    const j = (Math.random() - 0.5) * 80;
    select(addRoom(W / 2 - 75 + j, H / 2 - 60 + j, 150, 120, roomTitle()));
    updateSummary();
  });
  $("#room-name").addEventListener("input", (e) => {
    if (selected && selected.name() === "room") { selected.setAttr("roomName", e.target.value.trim()); updateLabel(selected); }
  });
  $("#scale").addEventListener("input", () => { gRooms.getChildren().forEach(updateLabel); updateSummary(); });

  /* ---------- Фон ---------- */
  let bgNode = null, bgData = null;
  function setBackground(url) {
    if (!url) { if (bgNode) bgNode.destroy(); bgNode = null; bgData = null; bgLayer.batchDraw(); return; }
    const img = new Image();
    img.onload = () => {
      if (bgNode) bgNode.destroy();
      const k = Math.min(W / img.width, H / img.height), w = img.width * k, h = img.height * k;
      bgNode = new Konva.Image({ image: img, x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
      bgLayer.add(bgNode);
      bgData = url;
      bgLayer.batchDraw();
      setStatus("Фон загружен. Расставьте датчики поверх него; масштаб укажите в поле «Масштаб».");
    };
    img.onerror = () => alert("Не удалось открыть изображение.");
    img.src = url;
  }
  async function handleImage(file) {
    if (!/^image\/(png|jpeg)$/.test(file.type)) { setStatus("Подходят только изображения JPG и PNG."); return alert("Подходят только изображения JPG и PNG."); }
    try { setBackground(await readDataUrl(file)); } catch (err) { setStatus(`Не удалось открыть изображение: ${err.message}`); }
  }
  $("#bg-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) handleImage(f).finally(() => { e.target.value = ""; });
  });
  $("#bg-clear").addEventListener("click", () => setBackground(null));

  /* ---------- Сборка плана из данных (пресеты и загрузка JSON) ---------- */
  function clearAll() {
    select(null);
    stage.container().style.cursor = "";
    [gRooms, gWalls, gOpen, gFurn, gLabels, sensorLayer].forEach((c) => c.destroyChildren());
    planLayer.batchDraw(); sensorLayer.batchDraw();
    updateSummary();
  }

  const list = (a) => (Array.isArray(a) ? a.slice(0, 300) : []);

  function buildPlan(p) {
    list(p.rooms).forEach((r) => {
      const name = String(r.name ?? "").slice(0, 40);
      if (Array.isArray(r.points) && r.points.length >= 6 && r.points.length % 2 === 0 && r.points.length <= 200 && r.points.every((v) => isNum(v))) addPolyRoom(r.points, name);
      else if (isNum(r.x, r.y, r.width, r.height)) addRoom(r.x, r.y, Math.max(30, r.width), Math.max(30, r.height), name);
    });
    list(p.walls).forEach((w) => {
      if (Array.isArray(w.points) && w.points.length >= 4 && w.points.length % 2 === 0 && w.points.length <= 200 && w.points.every((v) => isNum(v)))
        addWall(w.points, !!w.closed, isNum(w.thickness) ? w.thickness : 6);
    });
    list(p.windows).forEach((w) => { if (isNum(w.x, w.y, w.length, w.rotation)) addWindow({ ...w, thickness: isNum(w.thickness) ? w.thickness : 10 }); });
    list(p.doors).forEach((d) => { if (isNum(d.x, d.y, d.width, d.rotation)) addDoor({ ...d, thickness: isNum(d.thickness) ? d.thickness : 6 }); });
    list(p.furniture).forEach((f) => {
      if (FURNITURE_KINDS.includes(f.kind) && isNum(f.x, f.y, f.width, f.height) && f.width > 0 && f.height > 0)
        addFurniture({ ...f, rotation: isNum(f.rotation) ? f.rotation : 0 });
    });
    list(p.sensors).forEach((s) => { if (has(ICONS, s.type) && isNum(s.x, s.y)) addSensor(s.type, s.x, s.y, false); });
    planLayer.batchDraw();
  }

  function loadPreset(key) {
    clearAll();
    setBackground(null);
    $("#scale").value = M;
    buildPlan(makePlan(PRESETS[key]));
    updateSummary();
  }
  document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => loadPreset(b.dataset.preset)));

  $("#clear").addEventListener("click", () => {
    if (!confirm("Очистить холст? Всё нарисованное будет удалено. Чтобы сохранить текущий план, сначала скачайте шаблон.")) return;
    clearAll();
    setBackground(null);
  });

  /* ---------- Сохранение и загрузка JSON ---------- */
  function serialize() {
    const deg = (v) => ((Math.round(v) % 360) + 360) % 360;
    return {
      app: "kvartmetr", version: 2, scale: getScale(), background: bgData,
      rooms: Array.from(gRooms.getChildren()).map((n) => n instanceof Konva.Rect
        ? { kind: "rect", name: n.getAttr("roomName"), x: r1(n.x()), y: r1(n.y()), width: r1(n.width()), height: r1(n.height()) }
        : { kind: "poly", name: n.getAttr("roomName"), points: absPts(n).map(r1) }),
      walls: Array.from(gWalls.getChildren()).map((n) => ({ points: absPts(n).map(r1), closed: n.closed(), thickness: n.strokeWidth() })),
      doors: Array.from(gOpen.find(".door")).map((n) => ({ x: r1(n.x()), y: r1(n.y()), width: n.getAttr("dWidth"), rotation: deg(n.rotation()),
                                                 flip: n.getAttr("dFlip"), thickness: n.getAttr("dThick") })),
      windows: Array.from(gOpen.find(".window")).map((n) => ({ x: r1(n.x()), y: r1(n.y()), length: n.getAttr("wLen"), rotation: deg(n.rotation()),
                                                   thickness: n.getAttr("wThick") })),
      furniture: Array.from(gFurn.getChildren()).map((n) => ({ kind: n.getAttr("fKind"), x: r1(n.x()), y: r1(n.y()),   // x, y — центр предмета
                                                   width: n.getAttr("fW"), height: n.getAttr("fH"), rotation: deg(n.rotation()) })),
      sensors: Array.from(sensorLayer.find(".sensor")).map((g) => ({ type: g.getAttr("sType"), x: r1(g.x()), y: r1(g.y()) })),
    };
  }

  let fallbackUrl = null;
  // Запасной путь: обычная ссылка, по которой скачивание запускает сам пользователь (её не блокируют браузеры)
  function showDownloadLink(blob) {
    if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
    fallbackUrl = URL.createObjectURL(blob);
    const st = $("#ed-status");
    st.textContent = "Шаблон отправлен на скачивание (kvartmetr-plan.json). Если файл не появился — ";
    const link = document.createElement("a");
    link.href = fallbackUrl;
    link.download = "kvartmetr-plan.json";
    link.className = "link";
    link.textContent = "нажмите здесь";
    st.appendChild(link);
    st.appendChild(document.createTextNode("."));
  }

  $("#save").addEventListener("click", () => {
    let data;
    try { data = serialize(); } catch (err) { console.error(err); setStatus(`Не удалось собрать шаблон: ${err.message}`); return alert("Не удалось собрать шаблон. Попробуйте обновить страницу."); }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kvartmetr-plan.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {              // ссылку освобождаем не сразу: иначе часть браузеров отменяет скачивание
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    showDownloadLink(blob);
  });

  const GROUPS = ["rooms", "walls", "doors", "windows", "furniture", "sensors"];

  async function handleTemplate(file) {
    let d;
    try {
      d = JSON.parse(await readText(file));
      if (!d || typeof d !== "object" || !GROUPS.some((k) => Array.isArray(d[k]))) throw new Error("в файле нет данных планировки");
    } catch (err) {                      // холст не трогаем, пока файл не прочитан и не проверен
      setStatus(`Не удалось прочитать шаблон: ${err.message}`);
      return alert("Не удалось прочитать шаблон. Выберите JSON-файл, скачанный из этого конструктора.");
    }
    try {
      clearAll();
      $("#scale").value = Number(d.scale) > 0 ? d.scale : "";
      buildPlan(d);                      // версия 1 (только комнаты и датчики) тоже читается
      setBackground(typeof d.background === "string" && d.background.startsWith("data:image/") ? d.background : null);
      updateSummary();
      const n = (k) => (Array.isArray(d[k]) ? d[k].length : 0);
      setStatus(`Шаблон «${file.name}» загружен: комнат ${n("rooms")}, стен ${n("walls")}, дверей ${n("doors")}, окон ${n("windows")}, мебели ${n("furniture")}, датчиков ${n("sensors")}.`);
    } catch (err) {
      console.error(err);
      setStatus(`Ошибка при построении плана: ${err.message}`);
      alert("Шаблон прочитан, но построить план не удалось.");
    }
  }
  $("#load").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) handleTemplate(f).finally(() => { e.target.value = ""; });
  });

  /* ---------- Калькулятор ---------- */
  let order = null;

  function updateSummary() {
    const counts = { hub: 0, temperature: 0, leak: 0, smoke: 0, electricity: 0 };
    sensorLayer.find(".sensor").forEach((g) => counts[g.getAttr("sType")]++);
    const sensors = SENSOR_KEYS.reduce((n, k) => n + counts[k], 0);
    const lines = [{ key: "hub", qty: Math.max(1, counts.hub) }]
      .concat(SENSOR_KEYS.filter((k) => counts[k]).map((k) => ({ key: k, qty: counts[k] })))
      .map((l) => ({ ...l, sum: PRICES[l.key] * l.qty }));
    const equipment = lines.reduce((s, l) => s + l.sum, 0);
    const discount = sensors > DISCOUNT_OVER ? equipment * DISCOUNT : 0;
    const total = equipment - discount + PRICES.install;
    order = { lines, discount, total };

    const rows = lines.map((l) => `<li><span>${NAMES[l.key]} × ${l.qty}</span><b>${money(l.sum)}</b></li>`);
    if (discount) rows.push(`<li class="disc"><span>Скидка 10% на оборудование</span><b>−${money(discount)}</b></li>`);
    rows.push(`<li><span>Монтаж (базовый)</span><b>${money(PRICES.install)}</b></li>`);
    $("#lines").innerHTML = rows.join("");
    $("#total").textContent = money(total);
    $("#sensor-count").textContent = sensors;
    $("#discount-hint").textContent = discount
      ? "Скидка 10% на оборудование применена."
      : `Добавьте ещё ${DISCOUNT_OVER + 1 - sensors} шт. — и скидка 10% на оборудование.`;

    const s = getScale();
    const area = s > 0 ? gRooms.getChildren().reduce((a, r) => a + roomArea(r, s), 0) : 0;
    $("#area-row").hidden = !area;
    $("#area").textContent = area.toFixed(1).replace(".", ",");
  }

  $("#order").addEventListener("click", () => {
    const text = order.lines.map((l) => `${NAMES[l.key]} × ${l.qty} = ${money(l.sum)}`);
    if (order.discount) text.push(`Скидка 10%: −${money(order.discount)}`);
    text.push(`Монтаж (базовый): ${money(PRICES.install)}`);
    alert(`Заявка на установку КвартМетр\n\n${text.join("\n")}\n\nИтого: ${money(order.total)}\n\nМы свяжемся с вами для уточнения деталей.`);
  });

  loadPreset("one");   // при открытии страницы сразу показываем пример
  setStatus(`Редактор v${EDITOR_VERSION} готов.`);
})();
