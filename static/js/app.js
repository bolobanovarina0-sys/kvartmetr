/* КвартМетр — клиентская логика кабинета: план, Drag-and-Drop, графики */
(() => {
  const $ = (s) => document.querySelector(s);
  const REFRESH_MS = 6000;
  const num = (v, d = 0) => Number(v).toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
  const rub = (v) => `${num(Math.round(v))} ₽`;
  const clamp = (v) => Math.max(0, Math.min(100, v));
  const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const DROP = '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>';

  // Типы датчиков: иконка, подпись на метке, значение для карточки
  const TYPES = {
    temperature: { name: "Температура", icon: svg('<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"/>'),
      text: (v) => `Температура: ${num(v, 1)} °C`, big: (v) => `${num(v, 1)} °C` },
    humidity: { name: "Влажность", icon: svg(DROP),
      text: (v) => `Влажность: ${num(v)}%`, big: (v) => `${num(v)} %` },
    leak: { name: "Протечка", binary: true, icon: svg(DROP + '<path d="M9 14a3 3 0 0 0 3 3"/>'),
      text: (v) => `Протечки: ${v ? "Тревога" : "Норма"}`, big: (v) => (v ? "Тревога" : "Норма") },
    smoke: { name: "Дым", binary: true, icon: svg('<path d="M7 17a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 8.5 3.75 3.75 0 0 1 17.5 17z"/><path d="M8 21h8"/>'),
      text: (v) => `Дым: ${v ? "Тревога" : "ОК"}`, big: (v) => (v ? "Тревога" : "ОК") },
    electricity: { name: "Электричество", icon: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
      text: (v) => `Нагрузка: ${num(v, 2)} кВт`, big: (v) => `${num(v, 2)} кВт` },
  };
  const STATUS = { ok: "В норме", warn: "Вне нормы", alert: "Тревога" };

  const state = { apts: [], aptId: null, sensors: [], openId: null, dragId: null, timer: null,
                  donut: null, line: null, spark: null };

  /* ---------- Вспомогательное ---------- */
  async function api(url, opts = {}) {
    const headers = opts.body instanceof FormData ? {} : { "Content-Type": "application/json" };
    const r = await fetch(url, { ...opts, headers });
    if (r.status === 401) { location.href = "/login"; throw new Error("Нужно войти"); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Ошибка ${r.status}`);
    return data;
  }
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3500);
  }
  function setLive(ok) {
    const el = $("#live");
    el.dataset.state = ok ? "on" : "off";
    el.lastElementChild.textContent = ok ? "Система активна" : "Нет связи";
  }

  /* ---------- Графики ---------- */
  function initCharts() {
    Chart.defaults.font.family = "Inter, system-ui, sans-serif";
    Chart.defaults.color = "#6B7280";
    state.donut = new Chart($("#donut"), {
      type: "doughnut",
      data: { labels: [], datasets: [{ data: [], backgroundColor: ["#2563EB", "#14B8A6", "#A5B4FC"], borderWidth: 2, borderColor: "#fff" }] },
      options: { maintainAspectRatio: false, cutout: "68%", animation: { duration: 600 },
        plugins: { legend: { position: "right", labels: { usePointStyle: true, boxWidth: 8, padding: 14 } },
                   tooltip: { callbacks: { label: (c) => ` ${c.label}: ${rub(c.parsed)}` } } } },
    });
    state.line = new Chart($("#line"), {
      type: "line",
      data: { labels: [], datasets: [
        { label: "Факт", data: [], borderColor: "#2563EB", backgroundColor: "rgba(37,99,235,.08)", fill: true, tension: .3, pointRadius: 0, borderWidth: 2 },
        { label: "Прогноз", data: [], borderColor: "#94A3B8", borderDash: [6, 5], tension: .3, pointRadius: 0, borderWidth: 2 }] },
      options: { maintainAspectRatio: false, animation: { duration: 600 }, interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } },
                   tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${rub(c.parsed.y)}` } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
                  y: { beginAtZero: true, grid: { color: "#F1F5F9" }, ticks: { callback: (v) => num(v) } } } },
    });
  }

  function renderAnalytics(a) {
    $("#forecast").textContent = rub(a.forecast_total);
    $("#spent").textContent = rub(a.spent_now);
    $("#eclass").textContent = a.energy_class;
    $("#elabel").textContent = `(${a.energy_label})`;
    const hint = $("#hint");
    hint.textContent = a.hint;
    hint.dataset.tone = a.alert ? "alert" : "ok";
    state.donut.data.labels = Object.keys(a.split);
    state.donut.data.datasets[0].data = Object.values(a.split);
    state.donut.update();
    state.line.data.labels = a.labels;
    state.line.data.datasets[0].data = a.fact;
    state.line.data.datasets[1].data = a.forecast;
    state.line.update();
  }

  /* ---------- Метки на плане ---------- */
  function renderPins() {
    const layer = $("#pins");
    const seen = new Set();
    state.sensors.forEach((s) => {
      const t = TYPES[s.type];
      seen.add(String(s.id));
      let el = layer.querySelector(`[data-id="${s.id}"]`);
      if (!el) {
        el = document.createElement("div");
        el.className = "pin";
        el.draggable = true;
        el.tabIndex = 0;
        el.dataset.id = s.id;
        el.dataset.kind = t.binary ? "binary" : "analog";
        el.innerHTML = `<span class="pin-body"><span class="pin-icon">${t.icon}</span><span class="pin-text"></span></span>`;
        el.addEventListener("dragstart", (e) => {
          state.dragId = String(s.id);
          e.dataTransfer.setData("text/plain", `pin:${s.id}`);
          e.dataTransfer.effectAllowed = "move";
          requestAnimationFrame(() => el.classList.add("dragging"));
        });
        el.addEventListener("dragend", () => { state.dragId = null; el.classList.remove("dragging"); });
        el.addEventListener("click", () => openCard(s.id));
        el.addEventListener("keydown", (e) => { if (e.key === "Enter") openCard(s.id); });
        layer.appendChild(el);
      }
      el.dataset.status = s.status;
      if (state.dragId !== String(s.id)) { el.style.left = `${s.x}%`; el.style.top = `${s.y}%`; }
      el.querySelector(".pin-text").textContent = t.text(s.value);
    });
    layer.querySelectorAll(".pin").forEach((el) => { if (!seen.has(el.dataset.id)) el.remove(); });
  }
  function settle(id) {
    const el = $(`#pins [data-id="${id}"]`);
    if (!el) return;
    el.classList.remove("settle"); void el.offsetWidth; el.classList.add("settle");
  }

  /* ---------- Панель инструментов и Drag-and-Drop ---------- */
  function buildToolbar() {
    const bar = $("#toolbar");
    Object.entries(TYPES).forEach(([type, t]) => {
      const el = document.createElement("div");
      el.className = "tool";
      el.draggable = true;
      el.tabIndex = 0;
      el.innerHTML = `${t.icon}<span>${t.name}</span>`;
      el.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", `new:${type}`);
        e.dataTransfer.effectAllowed = "copy";
      });
      bar.appendChild(el);
    });
  }

  function initDropZone() {
    const plan = $("#plan"), img = $("#plan-img");
    plan.addEventListener("dragover", (e) => { e.preventDefault(); plan.classList.add("drop-active"); });
    plan.addEventListener("dragleave", (e) => { if (!plan.contains(e.relatedTarget)) plan.classList.remove("drop-active"); });
    plan.addEventListener("drop", async (e) => {
      e.preventDefault();
      plan.classList.remove("drop-active");
      const [kind, val] = (e.dataTransfer.getData("text/plain") || "").split(":");
      const r = img.getBoundingClientRect();
      // Острие метки «прилипает» к точке, где отпустили кнопку мыши
      const x = clamp(((e.clientX - r.left) / r.width) * 100);
      const y = clamp(((e.clientY - r.top) / r.height) * 100);
      try {
        if (kind === "new" && TYPES[val]) {
          const s = await api(`/api/apartments/${state.aptId}/sensors`, { method: "POST", body: JSON.stringify({ type: val, x, y }) });
          state.sensors.push(s); renderPins(); settle(s.id);
        } else if (kind === "pin") {
          const s = state.sensors.find((q) => String(q.id) === val);
          if (!s) return;
          s.x = x; s.y = y; renderPins(); settle(s.id);
          await api(`/api/sensors/${s.id}`, { method: "PATCH", body: JSON.stringify({ x, y }) });
        }
      } catch (err) { toast(err.message); }
    });
  }

  /* ---------- Карточка датчика ---------- */
  async function openCard(id) {
    state.openId = String(id);
    $("#sensor-card").hidden = false;
    await refreshCard();
  }
  function closeCard() {
    state.openId = null;
    $("#sensor-card").hidden = true;
    if (state.spark) { state.spark.destroy(); state.spark = null; }
  }
  async function refreshCard() {
    const s = state.sensors.find((q) => String(q.id) === state.openId);
    if (!s) return closeCard();
    const t = TYPES[s.type];
    $("#sc-icon").innerHTML = t.icon;
    $("#sc-name").textContent = t.name;
    $("#sc-time").textContent = `Обновлено в ${(s.ts || "").slice(11)}`;
    $("#sc-value").textContent = t.big(s.value);
    const badge = $("#sc-status");
    badge.textContent = STATUS[s.status]; badge.dataset.s = s.status;
    $("#sc-alarm").hidden = !t.binary;
    try {
      const h = await api(`/api/sensors/${s.id}/history`);
      if (state.openId !== String(s.id)) return;
      $("#sc-chart-box").hidden = !!t.binary;
      if (t.binary) {
        if (state.spark) { state.spark.destroy(); state.spark = null; }
        $("#sc-stats").textContent = `Тревог за последние ${h.values.length} замеров: ${h.values.filter((v) => v >= 1).length}`;
        return;
      }
      const min = Math.min(...h.values), max = Math.max(...h.values), avg = h.values.reduce((a, b) => a + b, 0) / h.values.length;
      $("#sc-stats").textContent = `Мин ${num(min, 1)} · средн. ${num(avg, 1)} · макс ${num(max, 1)}`;
      if (!state.spark) {
        state.spark = new Chart($("#sc-spark"), { type: "line",
          data: { labels: h.times, datasets: [{ data: h.values, borderColor: "#2563EB", borderWidth: 2, pointRadius: 0, tension: .35, fill: true, backgroundColor: "rgba(37,99,235,.08)" }] },
          options: { maintainAspectRatio: false, animation: { duration: 400 }, plugins: { legend: { display: false }, tooltip: { enabled: false } },
                     scales: { x: { display: false }, y: { display: false } } } });
      } else {
        state.spark.data.labels = h.times; state.spark.data.datasets[0].data = h.values; state.spark.update();
      }
    } catch (_) { /* карточка останется без графика */ }
  }

  /* ---------- Загрузка данных ---------- */
  async function tick() {
    const id = state.aptId;
    if (!id) return;
    try {
      const [sensors, an] = await Promise.all([api(`/api/apartments/${id}/sensors`), api(`/api/apartments/${id}/analytics`)]);
      if (id !== state.aptId) return;
      state.sensors = sensors;
      renderPins(); renderAnalytics(an);
      if (state.openId) refreshCard();
      setLive(true);
    } catch (_) { setLive(false); }
  }

  async function selectApartment(id) {
    state.aptId = id;
    const apt = state.apts.find((a) => a.id === id);
    $("#apt-select").value = id;
    $("#apt-name").textContent = apt.name;
    $("#plan-img").src = apt.layout_image_url;
    $("#download").href = `/api/apartments/${id}/report.csv`;
    $("#pins").innerHTML = "";
    state.sensors = [];
    closeCard();
    localStorage.setItem("km-apt", id);
    clearInterval(state.timer);
    await tick();
    state.timer = setInterval(tick, REFRESH_MS);
  }

  async function loadApartments(selectId) {
    state.apts = await api("/api/apartments");
    $("#apt-select").innerHTML = state.apts.map((a) => `<option value="${a.id}">${a.name} · ${num(a.area, 0)} м²</option>`).join("");
    const saved = Number(localStorage.getItem("km-apt"));
    const id = selectId || (state.apts.some((a) => a.id === saved) ? saved : state.apts[0].id);
    await selectApartment(id);
  }

  /* ---------- События интерфейса ---------- */
  $("#apt-select").addEventListener("change", (e) => selectApartment(Number(e.target.value)));
  $("#add-apt").addEventListener("click", () => $("#apt-dialog").showModal());
  $("#f-cancel").addEventListener("click", () => $("#apt-dialog").close());
  $("#apt-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const apt = await api("/api/apartments", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
      $("#apt-dialog").close(); e.target.reset();
      await loadApartments(apt.id);
    } catch (err) { toast(err.message); }
  });
  $("#upload").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      const r = await api(`/api/apartments/${state.aptId}/layout`, { method: "POST", body: fd });
      state.apts.find((a) => a.id === state.aptId).layout_image_url = r.url;
      $("#plan-img").src = `${r.url}?v=${Date.now()}`;
      toast("План загружен. Расставьте датчики заново, если нужно.");
    } catch (err) { toast(err.message); }
    e.target.value = "";
  });
  $("#sc-close").addEventListener("click", closeCard);
  $("#sc-alarm").addEventListener("click", async () => {
    try { await api(`/api/sensors/${state.openId}/alarm`, { method: "POST" }); await tick(); } catch (err) { toast(err.message); }
  });
  $("#sc-remove").addEventListener("click", async () => {
    const id = state.openId;
    try {
      await api(`/api/sensors/${id}`, { method: "DELETE" });
      state.sensors = state.sensors.filter((s) => String(s.id) !== id);
      closeCard(); renderPins();
    } catch (err) { toast(err.message); }
  });

  buildToolbar();
  initDropZone();
  initCharts();
  loadApartments().catch((e) => toast(e.message));
})();
