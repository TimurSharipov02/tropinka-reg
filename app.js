// Макет: вся логика работает в браузере на демо-данных из data.js.
// В рабочей версии регистрация, вход, сканы и топ идут через сервер —
// места, где он нужен, помечены «СЕРВЕР».
(function () {
  const R = window.RACE;
  const START = new Date(R.start).getTime();
  const MIN = 60 * 1000;
  const $ = (id) => document.getElementById(id);
  const cpById = Object.fromEntries(R.checkpoints.map((c) => [c.id, c]));

  const params = new URLSearchParams(location.search);
  let demo = params.get("demo");
  // «сейчас» для макета: до старта — реальное время, в гонке — 21:00 + 75 минут
  const now = () => (demo && demo !== "reg" ? START + 75 * MIN : Date.now());

  let user = null; // { nick }
  let myScans = []; // [[cpId, minutesAfterStart]]
  let pendingCp = null; // точка, отсканированная до входа

  /* ---------- утилиты ---------- */

  const store = {
    get() {
      try { return JSON.parse(localStorage.getItem("fgk_user")); } catch (e) { return null; }
    },
    set(v) {
      try { localStorage.setItem("fgk_user", JSON.stringify(v)); } catch (e) { /* приватный режим */ }
    },
  };

  const cleanNick = (s) => s.trim().replace(/^@/, "").toLowerCase();

  function clock(minutesAfterStart) {
    const d = new Date(START + minutesAfterStart * MIN);
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  }

  function distanceM(a, b) {
    const rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
  }

  function fmtDistance(m) {
    return m < 1000 ? Math.round(m) + " м" : (m / 1000).toFixed(1).replace(".", ",") + " км";
  }

  // очки = сумма ценности точек; при равенстве выше тот, кто набрал их раньше
  function standing(nick, scans) {
    const score = scans.reduce((s, [id]) => s + cpById[id].value, 0);
    const reachedAt = scans.length ? Math.max(...scans.map((x) => x[1])) : Infinity;
    return { nick, scans, score, reachedAt };
  }

  function leaderboard() {
    const rows = R.riders.map((r) => standing(r.nick, r.scans));
    if (user) rows.push({ ...standing(user.nick, myScans), me: true });
    return rows.sort((a, b) => b.score - a.score || a.reachedAt - b.reachedAt);
  }

  /* ---------- режимы ---------- */

  function render() {
    const raceOn = now() >= START;
    $("reg-view").hidden = raceOn;
    $("race-view").hidden = !raceOn;
    if (raceOn) renderRace();
    else tickCountdown();
    document.querySelectorAll(".demo button").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.demo === (demo || (raceOn ? (user ? "racer" : "guest") : "reg")));
    });
  }

  function tickCountdown() {
    const left = START - now();
    if (left <= 0) return render();
    const d = Math.floor(left / (24 * 60 * MIN));
    const h = Math.floor((left / (60 * MIN)) % 24);
    const m = Math.floor((left / MIN) % 60);
    $("countdown").textContent = d + " д " + String(h).padStart(2, "0") + " ч " + String(m).padStart(2, "0") + " мин";
  }

  function renderRace() {
    $("race-clock").textContent = clock((now() - START) / MIN);
    $("race-join").hidden = Boolean(user);
    $("me").hidden = !user;
    if (user) renderMe();
    renderCheckpoints();
    renderBoard();
  }

  function renderMe() {
    const rows = leaderboard();
    const place = rows.findIndex((r) => r.me) + 1;
    const me = rows[place - 1];
    $("me").innerHTML =
      '<span class="me__nick">@' + me.nick + "</span>" +
      '<span class="me__stat"><b>' + me.score + "</b> очк.</span>" +
      '<span class="me__stat"><b>' + me.scans.length + "/" + R.checkpoints.length + "</b> точек</span>" +
      '<span class="me__stat me__place"><b>#' + place + "</b> в топе</span>";
  }

  function renderCheckpoints() {
    const taken = Object.fromEntries(myScans.map(([id, t]) => [id, t]));
    $("cps").innerHTML = R.checkpoints
      .map((c) => {
        const t = taken[c.id];
        const map = "https://yandex.ru/maps/?pt=" + c.lng + "," + c.lat + "&z=17&l=map";
        return (
          '<li class="cp' + (c.final ? " cp--final" : "") + (t !== undefined ? " cp--done" : "") + '">' +
          '<span class="cp__value" title="ценность точки">×' + c.value + "</span>" +
          '<div class="cp__body">' +
          (c.final ? '<span class="cp__flag">финиш</span>' : "") +
          "<h3>" + c.name + "</h3>" +
          "<p>" + c.address + "</p>" +
          '<a class="cp__map" href="' + map + '" target="_blank" rel="noopener">на карте ↗</a>' +
          "</div>" +
          '<span class="cp__status">' + (t !== undefined ? "✓ " + clock(t) : user ? "не взята" : "") + "</span>" +
          "</li>"
        );
      })
      .join("");
  }

  function renderBoard() {
    $("board").innerHTML = leaderboard()
      .map((r, i) => {
        const dots = R.checkpoints
          .map((c) => '<i class="' + (r.scans.some((s) => s[0] === c.id) ? "on" : "") + (c.final ? " fin" : "") + '"></i>')
          .join("");
        return (
          '<li class="row' + (r.me ? " row--me" : "") + (i < 3 ? " row--top" : "") + '">' +
          '<span class="row__place">' + (i + 1) + "</span>" +
          '<div class="row__who"><b>@' + r.nick + '</b><span class="row__dots">' + dots + "</span></div>" +
          '<div class="row__score"><b>' + r.score + "</b><small>" + (r.scans.length ? "к " + clock(r.reachedAt) : "—") + "</small></div>" +
          "</li>"
        );
      })
      .join("");
  }

  /* ---------- вход ---------- */

  $("login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const nick = cleanNick($("login-nick").value);
    const saved = store.get();
    // СЕРВЕР: проверить ник по списку оплаченных регистраций (лучше — вход через Telegram)
    const known = (saved && saved.nick === nick) || nick === R.demoUser.nick;
    if (!nick) return ($("login-error").textContent = "Введи ник");
    if (!known) return ($("login-error").textContent = "Не нашли такой ник среди зарегистрированных");
    $("login-error").textContent = "";
    signIn(nick);
    render();
    if (pendingCp) scan(...pendingCp);
  });

  function signIn(nick) {
    user = { nick };
    myScans = nick === R.demoUser.nick ? R.demoUser.scans.slice() : [];
    store.set({ nick });
  }

  /* ---------- вкладки ---------- */

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

  /* ---------- скан QR ---------- */
  // QR-код на точке содержит ссылку вида  https://сайт/?cp=c4&k=секрет
  // Камера телефона открывает сайт, мы берём геолокацию и сверяем расстояние.

  function showSheet(state, title, text, step, icon, action) {
    const sheet = $("scan-sheet");
    sheet.hidden = false;
    sheet.dataset.state = state;
    $("scan-step").textContent = step;
    $("scan-icon").textContent = icon;
    $("scan-title").textContent = title;
    $("scan-text").innerHTML = text;
    $("scan-close").textContent = action || "К точкам";
    sheet.querySelector(".sheet__card").focus();
  }

  function scan(cpId, fakePosition) {
    const cp = cpById[cpId];
    if (!cp) return;
    if (now() < START) return showSheet("far", "Ещё рано", "Сканы засчитываются с 21:00.", "Точка " + cp.name, "⏳");
    if (!user) {
      pendingCp = [cpId, fakePosition];
      return showSheet("far", cp.name, "Войди ником из регистрации — и точка засчитается сразу после входа.", "Нужен вход", "@", "Войти");
    }
    pendingCp = null;
    if (myScans.some((s) => s[0] === cpId)) return showSheet("ok", cp.name, "Эта точка у тебя уже есть.", "Уже взята", "✓");

    showSheet("wait", cp.name, "Разреши доступ к геолокации, чтобы засчитать точку.", "Проверяем геолокацию…", "📍");

    const check = (pos) => {
      const dist = distanceM(pos, cp);
      if (dist > R.radius) {
        return showSheet("far", cp.name,
          "Ты в <b>" + fmtDistance(dist) + "</b> от точки. Скан засчитывается в радиусе " + R.radius + " м — подъедь ближе и отсканируй ещё раз.",
          "Слишком далеко", "✗");
      }
      // СЕРВЕР: отправить { cp, k, lat, lng, accuracy } — сервер сам проверит секрет, расстояние и время
      const t = Math.round((now() - START) / MIN);
      myScans.push([cpId, t]);
      render();
      const place = leaderboard().findIndex((r) => r.me) + 1;
      showSheet("ok", cp.name,
        "+" + cp.value + " очк. · " + fmtDistance(dist) + " от точки<br>Теперь ты <b>#" + place + "</b> в топе." +
          (cp.final ? "<br>Финиш! Паркуй велик — внутри награждение и туса." : ""),
        "Точка засчитана · " + clock(t), cp.final ? "🎃" : "✓");
    };

    if (fakePosition) return setTimeout(() => check(fakePosition), 600);
    if (!navigator.geolocation) return showSheet("far", cp.name, "Браузер не даёт геолокацию — открой ссылку в Chrome или Safari.", "Нет геолокации", "✗");
    navigator.geolocation.getCurrentPosition(
      (p) => check({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => showSheet("far", cp.name, "Без геолокации точку не засчитать. Разреши доступ в настройках браузера и отсканируй код ещё раз.", "Доступ запрещён", "✗"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  $("scan-close").addEventListener("click", () => {
    $("scan-sheet").hidden = true;
    if (pendingCp && !user) {
      $("race-join").scrollIntoView({ behavior: "smooth", block: "center" });
      $("login-nick").focus({ preventScroll: true });
    }
    if (params.has("cp")) history.replaceState(null, "", location.pathname + (demo ? "?demo=" + demo : ""));
  });

  /* ---------- регистрация ---------- */

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

  function values() {
    const checked = form.querySelector('input[name="gender"]:checked');
    return {
      telegram: cleanNick(form.telegram.value),
      gender: checked ? checked.value : "",
      payment: form.payment.value.trim(),
    };
  }

  form.addEventListener("input", (e) => {
    if (e.target.name) setError(e.target.name, "");
  });

  form.addEventListener("change", (e) => {
    if (e.target.name === "gender") genderHint.hidden = e.target.value !== "Ж";
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = values();
    const firstInvalid = ["telegram", "gender", "payment"].filter((k) => {
      setError(k, v[k] ? "" : REQUIRED);
      return !v[k];
    })[0];
    if (firstInvalid) return form.querySelector('[name="' + firstInvalid + '"]').focus();

    submit.classList.add("is-loading");
    submit.disabled = true;
    // СЕРВЕР: сохранить регистрацию (или отправить в Google Форму)
    setTimeout(() => {
      store.set({ nick: v.telegram });
      submit.classList.remove("is-loading");
      submit.disabled = false;
      form.hidden = true;
      done.hidden = false;
      done.focus();
    }, 700);
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

  /* ---------- переключатель состояний макета ---------- */

  function applyDemo(mode) {
    demo = mode;
    $("scan-sheet").hidden = true;
    user = null;
    myScans = [];
    if (!["reg", "guest", "scan-guest"].includes(mode)) signIn(R.demoUser.nick);
    render();
    const near = { lat: cpById.c6.lat + 0.0002, lng: cpById.c6.lng + 0.0002 };
    const far = { lat: cpById.c5.lat + 0.015, lng: cpById.c5.lng + 0.02 };
    if (mode === "scan-ok") scan("c6", near);
    if (mode === "scan-far") scan("c5", far);
    if (mode === "scan-guest") scan("c6", near);
  }

  document.querySelectorAll(".demo button").forEach((b) =>
    b.addEventListener("click", () => {
      history.replaceState(null, "", "?demo=" + b.dataset.demo);
      applyDemo(b.dataset.demo);
    })
  );

  /* ---------- старт ---------- */

  if (demo) {
    applyDemo(demo);
  } else {
    const saved = store.get();
    if (saved && saved.nick) signIn(saved.nick);
    render();
    if (params.has("cp")) scan(params.get("cp"));
  }
  setInterval(() => (now() < START ? tickCountdown() : render()), 30 * 1000);
})();
