// Сайт аллейката. Данные берутся с сервера (Google Apps Script, см. server/),
// а если в config.js не задан apiUrl или в адресе есть ?demo=… — из демо-данных data.js.
(function () {
  const CFG = window.CONFIG || {};
  const MIN = 60 * 1000;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const DEMO = !CFG.apiUrl || params.has("demo");

  /* ================= состояние ================= */

  let state = null; // { now, start, radius, open, checkpoints, leaderboard }
  let clockOffset = 0; // серверное время − локальное
  let user = null; // { nick }
  let pendingScan = null; // скан, сделанный до входа

  const now = () => Date.now() + clockOffset;
  const raceOn = () => state && now() >= state.start;

  const store = {
    get() {
      try { return JSON.parse(localStorage.getItem("fgk_user")); } catch (e) { return null; }
    },
    set(v) {
      try { localStorage.setItem("fgk_user", JSON.stringify(v)); } catch (e) { /* приватный режим */ }
    },
  };

  /* ================= сервер ================= */

  const remote = {
    async state() {
      const res = await fetch(CFG.apiUrl + "?action=state", { cache: "no-store" });
      return res.json();
    },
    async call(action, data) {
      // text/plain — чтобы браузер не делал preflight-запрос, который Apps Script не поддерживает
      const res = await fetch(CFG.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(Object.assign({ action }, data)),
      });
      return res.json();
    },
    register: (v) => remote.call("register", v),
    login: (nick) => remote.call("login", { nick }),
    scan: (v) => remote.call("scan", v),
  };

  /* ================= демо ================= */

  const demo = (function () {
    const R = window.RACE;
    const START = Date.parse(R.start);
    const at = (m) => START + m * MIN;
    const byId = Object.fromEntries(R.checkpoints.map((c) => [c.id, c]));
    let mode = params.get("demo") || "reg";
    let mine = []; // сканы демо-участника

    function board() {
      const all = R.riders.map((r) => ({ nick: r.nick, scans: r.scans.map(([id, m]) => [id, at(m)]) }));
      if (mine.length) all.push({ nick: R.demoUser.nick, scans: mine });
      return all
        .map((r) => ({
          nick: r.nick,
          scans: r.scans,
          score: r.scans.reduce((s, [id]) => s + byId[id].value, 0),
          reachedAt: Math.max(...r.scans.map((x) => x[1])),
        }))
        .sort((a, b) => b.score - a.score || a.reachedAt - b.reachedAt);
    }

    return {
      setMode(m) {
        mode = m;
        mine = m === "reg" ? [] : R.demoUser.scans.map(([id, m2]) => [id, at(m2)]);
      },
      fakePosition(cpId, far) {
        const c = byId[cpId];
        return far ? { lat: c.lat + 0.015, lng: c.lng + 0.02, accuracy: 12 } : { lat: c.lat + 0.0002, lng: c.lng + 0.0002, accuracy: 12 };
      },
      async state() {
        const t = mode === "reg" ? Date.now() : at(75);
        const s = { now: t, start: START, radius: R.radius, open: t >= START };
        if (s.open) Object.assign(s, { checkpoints: R.checkpoints, leaderboard: board() });
        return s;
      },
      async register(v) {
        return { ok: true, nick: cleanNick(v.telegram) };
      },
      async login(nick) {
        const n = cleanNick(nick);
        const saved = store.get();
        return n === R.demoUser.nick || (saved && saved.nick === n)
          ? { ok: true, nick: n }
          : { ok: false, error: "Не нашли @" + (n || nick) + " среди зарегистрированных" };
      },
      async scan(v) {
        const c = byId[v.cp];
        if (!c) return { ok: false, error: "Такой точки нет" };
        const had = mine.find((x) => x[0] === v.cp);
        if (had) return { ok: true, already: true, cp: v.cp, at: had[1] };
        const d = distanceM(v, c);
        if (d > R.radius) return { ok: false, far: true, distance: Math.round(d), radius: R.radius, cp: v.cp };
        const t = at(75);
        mine.push([v.cp, t]);
        return { ok: true, cp: v.cp, value: c.value, distance: Math.round(d), at: t };
      },
    };
  })();

  const api = DEMO ? demo : remote;

  /* ================= утилиты ================= */

  function cleanNick(v) {
    const nick = String(v || "").trim().toLowerCase().replace(/^https?:\/\/t\.me\//, "").replace(/^@/, "");
    return /^[a-z0-9_]{3,32}$/.test(nick) ? nick : "";
  }

  const fmtTime = (ms) =>
    new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: CFG.timezone || "Europe/Moscow" });

  function distanceM(a, b) {
    const rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
  }

  const fmtDistance = (m) => (m < 1000 ? Math.round(m) + " м" : (m / 1000).toFixed(1).replace(".", ",") + " км");

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const cpName = (id) => ((state && state.checkpoints) || []).find((c) => c.id === id)?.name || "Точка";

  function myRow() {
    const board = (state && state.leaderboard) || [];
    const i = board.findIndex((r) => r.nick === user.nick);
    return i >= 0 ? { ...board[i], place: i + 1 } : { nick: user.nick, score: 0, scans: [], place: null };
  }

  /* ================= загрузка ================= */

  async function refresh() {
    try {
      const s = await api.state();
      if (s.ok === false) throw new Error(s.error);
      state = s;
      clockOffset = s.now - Date.now();
    } catch (err) {
      if (!state) $("countdown").textContent = "нет связи с сервером";
      return;
    }
    render();
  }

  /* ================= отрисовка ================= */

  function render() {
    if (!state) return;
    const on = raceOn();
    if (on && !state.open) return refresh(); // старт наступил — забираем точки
    $("reg-view").hidden = on;
    $("race-view").hidden = !on;
    if (on) renderRace();
    else tickCountdown();
    if (DEMO) {
      const cur = params.get("demo") || (on ? (user ? "racer" : "guest") : "reg");
      document.querySelectorAll(".demo button").forEach((b) => b.classList.toggle("is-active", b.dataset.demo === cur));
    }
  }

  function tickCountdown() {
    const left = state.start - now();
    if (left <= 0) return render();
    const d = Math.floor(left / (24 * 60 * MIN));
    const h = Math.floor((left / (60 * MIN)) % 24);
    const m = Math.floor((left / MIN) % 60);
    $("countdown").textContent = d + " д " + String(h).padStart(2, "0") + " ч " + String(m).padStart(2, "0") + " мин";
  }

  function renderRace() {
    $("race-clock").textContent = fmtTime(now());
    $("race-join").hidden = Boolean(user);
    $("me").hidden = !user;
    if (user) renderMe();
    renderCheckpoints();
    renderBoard();
  }

  function renderMe() {
    const me = myRow();
    $("me").innerHTML =
      '<span class="me__nick">@' + esc(me.nick) + "</span>" +
      '<span class="me__stat"><b>' + me.score + "</b> очк.</span>" +
      '<span class="me__stat"><b>' + me.scans.length + "/" + state.checkpoints.length + "</b> точек</span>" +
      '<span class="me__stat me__place"><b>' + (me.place ? "#" + me.place : "—") + "</b> в топе</span>";
  }

  function renderCheckpoints() {
    const taken = user ? Object.fromEntries(myRow().scans) : {};
    $("cps").innerHTML = state.checkpoints
      .map((c) => {
        const t = taken[c.id];
        const map = "https://yandex.ru/maps/?pt=" + c.lng + "," + c.lat + "&z=17&l=map";
        return (
          '<li class="cp' + (c.final ? " cp--final" : "") + (t ? " cp--done" : "") + '">' +
          '<span class="cp__value" title="ценность точки">×' + c.value + "</span>" +
          '<div class="cp__body">' +
          (c.final ? '<span class="cp__flag">финиш</span>' : "") +
          "<h3>" + esc(c.name) + "</h3>" +
          "<p>" + esc(c.address) + "</p>" +
          '<a class="cp__map" href="' + map + '" target="_blank" rel="noopener">на карте ↗</a>' +
          "</div>" +
          '<span class="cp__status">' + (t ? "✓ " + fmtTime(t) : user ? "не взята" : "") + "</span>" +
          "</li>"
        );
      })
      .join("");
  }

  function renderBoard() {
    const board = state.leaderboard;
    if (!board.length) {
      $("board").innerHTML = '<li class="board__empty">Пока никто не отсканировал ни одной точки</li>';
      return;
    }
    $("board").innerHTML = board
      .map((r, i) => {
        const has = new Set(r.scans.map((s) => s[0]));
        const dots = state.checkpoints.map((c) => '<i class="' + (has.has(c.id) ? "on" : "") + (c.final ? " fin" : "") + '"></i>').join("");
        return (
          '<li class="row' + (user && r.nick === user.nick ? " row--me" : "") + (i < 3 ? " row--top" : "") + '">' +
          '<span class="row__place">' + (i + 1) + "</span>" +
          '<div class="row__who"><b>@' + esc(r.nick) + '</b><span class="row__dots">' + dots + "</span></div>" +
          '<div class="row__score"><b>' + r.score + "</b><small>к " + fmtTime(r.reachedAt) + "</small></div>" +
          "</li>"
        );
      })
      .join("");
  }

  /* ================= вход ================= */

  function signIn(nick) {
    user = { nick };
    store.set({ nick });
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = $("login-nick").value;
    if (!cleanNick(raw)) return ($("login-error").textContent = "Ник в Telegram: латиница, цифры и _");
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const res = await api.login(raw);
      if (!res.ok) return ($("login-error").textContent = res.error);
      $("login-error").textContent = "";
      signIn(res.nick);
      render();
      if (pendingScan) scan(...pendingScan);
    } catch (err) {
      $("login-error").textContent = "Нет связи с сервером, попробуй ещё раз";
    } finally {
      btn.disabled = false;
    }
  });

  /* ================= вкладки ================= */

  document.querySelectorAll(".tabs__btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabs__btn").forEach((b) => {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-selected", b === btn);
      });
      $("tab-points").hidden = btn.dataset.tab !== "points";
      $("tab-top").hidden = btn.dataset.tab !== "top";
    })
  );

  /* ================= скан QR ================= */
  // QR-код на точке — ссылка вида  https://сайт/?cp=<id>&k=<секрет>.
  // Камера телефона открывает сайт, берём геолокацию, сервер проверяет секрет и расстояние.

  function showSheet(kind, title, text, step, icon, action) {
    const sheet = $("scan-sheet");
    sheet.hidden = false;
    sheet.dataset.state = kind;
    $("scan-step").textContent = step;
    $("scan-icon").textContent = icon;
    $("scan-title").textContent = title;
    $("scan-text").innerHTML = text;
    $("scan-close").textContent = action || "К точкам";
    sheet.querySelector(".sheet__card").focus();
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Браузер не даёт геолокацию — открой ссылку в Chrome или Safari."));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => reject(new Error("Без геолокации точку не засчитать. Разреши доступ в настройках браузера и отсканируй код ещё раз.")),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      );
    });
  }

  async function scan(cp, k, fakePosition) {
    if (!raceOn()) return showSheet("far", "Ещё рано", "Сканы засчитываются с момента старта.", "До старта", "⏳");
    const name = cpName(cp);
    if (!user) {
      pendingScan = [cp, k, fakePosition];
      return showSheet("far", name, "Войди ником из регистрации — и точка засчитается сразу после входа.", "Нужен вход", "@", "Войти");
    }
    pendingScan = null;

    showSheet("wait", name, "Разреши доступ к геолокации, чтобы засчитать точку.", "Проверяем геолокацию…", "📍");
    let pos;
    try {
      pos = fakePosition || (await getPosition());
    } catch (err) {
      return showSheet("far", name, err.message, "Нет геолокации", "✗");
    }

    showSheet("wait", name, "Отправляем скан…", "Проверяем геолокацию…", "📍");
    let res;
    try {
      res = await api.scan({ nick: user.nick, cp, k, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy });
    } catch (err) {
      return showSheet("far", name, "Нет связи с сервером. Проверь интернет и отсканируй код ещё раз.", "Ошибка сети", "✗");
    }

    if (res.far) {
      return showSheet("far", name,
        "Ты в <b>" + fmtDistance(res.distance) + "</b> от точки. Скан засчитывается в радиусе " + res.radius + " м — подъедь ближе и отсканируй ещё раз.",
        "Слишком далеко", "✗");
    }
    if (!res.ok) return showSheet("far", name, esc(res.error), "Не засчитано", "✗");
    if (res.already) return showSheet("ok", name, "Эта точка у тебя уже есть.", "Взята в " + fmtTime(res.at), "✓");

    await refresh();
    const me = myRow();
    const final = (state.checkpoints.find((c) => c.id === cp) || {}).final;
    showSheet("ok", name,
      "+" + res.value + " очк. · " + fmtDistance(res.distance) + " от точки" +
        (me.place ? "<br>Теперь ты <b>#" + me.place + "</b> в топе." : "") +
        (final ? "<br>Финиш! Паркуй велик — внутри награждение и туса." : ""),
      "Точка засчитана · " + fmtTime(res.at), final ? "🎃" : "✓");
  }

  $("scan-close").addEventListener("click", () => {
    $("scan-sheet").hidden = true;
    if (pendingScan && !user) {
      $("race-join").scrollIntoView({ behavior: "smooth", block: "center" });
      $("login-nick").focus({ preventScroll: true });
    }
    if (params.has("cp")) {
      params.delete("cp");
      params.delete("k");
      history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : ""));
    }
  });

  /* ================= регистрация ================= */

  const form = $("reg-form");
  const done = $("done");
  const submit = form.querySelector(".submit");
  const genderHint = $("gender-hint");
  const REQUIRED = "Это обязательный вопрос";

  function setError(name, message) {
    const field = form.querySelector('[data-field="' + name + '"]');
    field.classList.toggle("is-invalid", Boolean(message));
    field.querySelector(".field__error").textContent = message || "";
  }

  form.addEventListener("input", (e) => {
    if (e.target.name) setError(e.target.name, "");
    $("form-status").textContent = "";
  });

  form.addEventListener("change", (e) => {
    if (e.target.name === "gender") genderHint.hidden = e.target.value !== "Ж";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const checked = form.querySelector('input[name="gender"]:checked');
    const v = { telegram: form.telegram.value, gender: checked ? checked.value : "", payment: form.payment.value.trim() };
    const errors = {
      telegram: !v.telegram.trim() ? REQUIRED : !cleanNick(v.telegram) ? "Ник в Telegram: латиница, цифры и _ (от 3 символов)" : "",
      gender: v.gender ? "" : REQUIRED,
      payment: v.payment ? "" : REQUIRED,
    };
    Object.keys(errors).forEach((k) => setError(k, errors[k]));
    const firstInvalid = Object.keys(errors).find((k) => errors[k]);
    if (firstInvalid) return form.querySelector('[name="' + firstInvalid + '"]').focus();

    submit.classList.add("is-loading");
    submit.disabled = true;
    try {
      const res = await api.register(v);
      if (!res.ok) {
        $("form-status").textContent = res.error;
        return;
      }
      signIn(res.nick);
      $("done-text").textContent = res.already
        ? "@" + res.nick + " уже был в списке — всё в силе. 30 октября в 21:00 здесь появятся точки маршрута."
        : "30 октября в 21:00 здесь появятся точки маршрута — ты уже будешь в игре под @" + res.nick + ". Не забудь шлем.";
      form.hidden = true;
      done.hidden = false;
      done.focus();
    } catch (err) {
      $("form-status").textContent = "Нет связи с сервером, попробуй ещё раз";
    } finally {
      submit.classList.remove("is-loading");
      submit.disabled = false;
    }
  });

  $("again").addEventListener("click", () => {
    form.reset();
    genderHint.hidden = true;
    done.hidden = true;
    form.hidden = false;
    form.telegram.focus();
  });

  const phoneBtn = $("copy-phone");
  const hint = $("copy-hint");
  phoneBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(phoneBtn.dataset.phone);
      hint.textContent = "Скопировано ✓";
    } catch (err) {
      hint.textContent = phoneBtn.dataset.phone;
    }
    setTimeout(() => (hint.textContent = "Тимур · нажми, чтобы скопировать"), 2000);
  });

  /* ================= переключатель состояний (только демо) ================= */

  async function applyDemo(mode) {
    demo.setMode(mode);
    params.set("demo", mode);
    $("scan-sheet").hidden = true;
    user = null;
    pendingScan = null;
    if (!["reg", "guest", "scan-guest"].includes(mode)) signIn(window.RACE.demoUser.nick);
    await refresh();
    if (mode === "scan-ok") scan("c6", "demo", demo.fakePosition("c6"));
    if (mode === "scan-far") scan("c5", "demo", demo.fakePosition("c5", true));
    if (mode === "scan-guest") scan("c6", "demo", demo.fakePosition("c6"));
  }

  const demoNav = document.querySelector(".demo");
  demoNav.hidden = !DEMO;
  demoNav.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      history.replaceState(null, "", "?demo=" + b.dataset.demo);
      applyDemo(b.dataset.demo);
    })
  );

  /* ================= старт ================= */

  (async function init() {
    if (DEMO && params.has("demo")) return applyDemo(params.get("demo"));
    const saved = store.get();
    if (saved && cleanNick(saved.nick)) user = { nick: saved.nick };
    if (DEMO) demo.setMode("reg");
    await refresh();
    if (params.has("cp")) scan(params.get("cp"), params.get("k"));
  })();

  // во время гонки обновляем топ, до старта — только отсчёт
  setInterval(() => (raceOn() ? refresh() : state && tickCountdown()), 20 * 1000);
})();
