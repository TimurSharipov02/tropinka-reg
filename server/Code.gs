/**
 * FGK CloseSeason 26 — сервер аллейката на Google Apps Script.
 *
 * Данные лежат в этой же Google Таблице:
 *   «Настройки»   — время старта, радиус засчёта, адрес сайта
 *   «Регистрации» — ники участников, сумма и галочка «Оплачено»
 *                   (колонка «Допуск»: «нет» — не пускать в гонку)
 *   «Точки»       — точки маршрута, их ценность, секреты и ссылки для QR
 *   «Сканы»       — журнал всех попыток скана со статусом
 *
 * Если таблица — это таблица ответов Google Формы, ответы формы автоматически
 * переносятся в «Регистрации» (лист формы остаётся как есть).
 *
 * Установка — см. server/README.md.
 */

var SHEETS = {
  settings: "Настройки",
  regs: "Регистрации",
  points: "Точки",
  scans: "Сканы",
};

var HEADERS = {
  regs: ["Время", "Ник", "Пол", "Источник оплаты", "Сумма, ₽", "Оплачено", "Допуск"],
  points: ["ID", "Название", "Адрес", "Широта", "Долгота", "Ценность", "Финиш", "Секрет", "Ссылка для QR", "QR"],
  scans: ["Время", "Ник", "Точка", "Очки", "Расстояние, м", "Точность, м", "Статус"],
};

var DEFAULT_SETTINGS = [
  ["Старт", "2026-10-30T21:00:00+03:00"],
  ["Радиус, м", "150"],
  ["Адрес сайта", "https://timirsharipov.github.io/tropinka-reg/"],
  ["Цена, ₽", "300"],
  ["Цена после повышения, ₽", "600"],
  ["Повышение цены", "2026-10-26T00:00:00+03:00"],
  ["Гонка только после оплаты", "нет"],
];

var COL_PAID = 6; // колонка «Оплачено» на листе «Регистрации»
var YES = /^(да|yes|1|true|x|✓)$/i;
var OK = "ok";
var CACHE_SECONDS = 10;
var MAX_ACCURACY_M = 500; // хуже этой точности геолокацию не принимаем
var ACCURACY_BONUS_M = 50; // допуск на погрешность GPS сверх радиуса

/* ================= HTTP ================= */

function doGet(e) {
  return handle_(function () {
    var p = (e && e.parameter) || {};
    var action = p.action || "state";
    if (action === "state") return getState_();
    if (action === "me") return me_(p.nick);
    throw userError_("Неизвестное действие");
  });
}

function doPost(e) {
  return handle_(function () {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (body.action === "register") return register_(body);
    if (body.action === "login") return login_(body);
    if (body.action === "scan") return scan_(body);
    throw userError_("Неизвестное действие");
  });
}

function handle_(fn) {
  var out;
  try {
    out = fn();
    out.ok = out.ok !== false;
  } catch (err) {
    out = { ok: false, error: err.userMessage || "Ошибка сервера, попробуй ещё раз" };
    if (!err.userMessage) console.error(err && err.stack ? err.stack : err);
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function userError_(message) {
  var err = new Error(message);
  err.userMessage = message;
  return err;
}

/* ================= действия ================= */

function getState_() {
  var s = settings_();
  var now = Date.now();
  var state = { now: now, start: s.start, radius: s.radius, open: now >= s.start };
  if (!state.open) return state; // до старта точки не раскрываем

  var cache = CacheService.getScriptCache();
  var cached = cache.get("public");
  var pub = cached ? JSON.parse(cached) : null;
  if (!pub) {
    var points = readPoints_();
    pub = { checkpoints: points.map(publicPoint_), leaderboard: leaderboard_(points, readScans_()) };
    cache.put("public", JSON.stringify(pub), CACHE_SECONDS);
  }
  state.checkpoints = pub.checkpoints;
  state.leaderboard = pub.leaderboard;
  return state;
}

function register_(body) {
  var s = settings_();
  if (Date.now() >= s.start) throw userError_("Регистрация закрыта — аллейкат уже идёт");

  var nick = cleanNick_(body.telegram);
  var gender = String(body.gender || "").trim();
  var payment = String(body.payment || "").trim().slice(0, 200);
  if (!nick) throw userError_("Проверь ник в Telegram: латиница, цифры и _");
  if (gender !== "М" && gender !== "Ж") throw userError_("Выбери пол");
  if (!payment) throw userError_("Укажи источник оплаты");

  return withLock_(function () {
    var existing = findRegistration_(nick);
    if (existing) return status_(existing, { already: true });
    var amount = addRegistration_(s, new Date(), nick, gender, payment);
    return status_({ nick: nick, amount: amount, paid: amount === 0, blocked: false }, { already: false });
  });
}

function addRegistration_(s, time, nick, gender, payment) {
  var amount = price_(s, gender, time.getTime());
  var sh = sheet_("regs");
  sh.appendRow([time, nick, gender, payment, amount, amount === 0, ""]);
  sh.getRange(sh.getLastRow(), COL_PAID).insertCheckboxes();
  return amount;
}

// статус регистрации и оплаты — чтобы участник видел, подтверждён ли перевод
function me_(raw) {
  var nick = cleanNick_(raw);
  var reg = nick && findRegistration_(nick);
  if (!reg) throw userError_("Не нашли такой ник среди зарегистрированных");
  return status_(reg, {});
}

function status_(reg, extra) {
  var out = { nick: reg.nick, amount: reg.amount, paid: reg.paid, blocked: reg.blocked };
  for (var k in extra) out[k] = extra[k];
  return out;
}

function price_(s, gender, at) {
  if (gender === "Ж") return 0;
  return at < s.priceChange ? s.priceEarly : s.priceLate;
}

function login_(body) {
  var nick = cleanNick_(body.nick);
  if (!nick) throw userError_("Введи ник в Telegram");
  var reg = findRegistration_(nick);
  if (!reg) throw userError_("Не нашли @" + nick + " среди зарегистрированных");
  if (reg.blocked) throw userError_("@" + nick + " пока не допущен к гонке — напиши организаторам");
  return status_(reg, {});
}

function scan_(body) {
  var s = settings_();
  var nick = cleanNick_(body.nick);
  var cpId = String(body.cp || "").trim();
  var lat = Number(body.lat);
  var lng = Number(body.lng);
  var accuracy = Number(body.accuracy) || 0;

  return withLock_(function () {
    var log = function (point, status, distance) {
      sheet_("scans").appendRow([
        new Date(), nick || String(body.nick || ""), cpId,
        status === OK ? point.value : 0,
        distance == null ? "" : Math.round(distance),
        accuracy ? Math.round(accuracy) : "",
        status,
      ]);
    };
    var fail = function (point, status, message, distance) {
      log(point || { value: 0 }, status, distance);
      throw userError_(message);
    };

    if (Date.now() < s.start) fail(null, "рано", "Сканы засчитываются с момента старта");

    var reg = nick && findRegistration_(nick);
    if (!reg) fail(null, "нет регистрации", "Войди ником из регистрации");
    if (reg.blocked) fail(null, "не допущен", "Ты пока не допущен к гонке — напиши организаторам");
    if (s.requirePaid && !reg.paid) fail(null, "не оплачено", "Оплата ещё не подтверждена — покажи перевод организаторам");

    var point = readPoints_().filter(function (p) { return p.id === cpId; })[0];
    if (!point) fail(null, "нет точки", "Такой точки нет — отсканируй код ещё раз");
    if (!body.k || String(body.k) !== point.secret) fail(point, "неверный код", "QR-код не подошёл — отсканируй код прямо на точке");

    var already = readScans_().filter(function (x) { return x.nick === nick && x.cp === cpId; })[0];
    if (already) return { already: true, cp: cpId, at: already.at };

    if (!isFinite(lat) || !isFinite(lng)) fail(point, "нет геолокации", "Не получили геолокацию — разреши доступ и отсканируй ещё раз");
    if (accuracy > MAX_ACCURACY_M) fail(point, "низкая точность", "Геолокация слишком неточная — включи GPS и попробуй ещё раз");

    var distance = distanceM_({ lat: lat, lng: lng }, point);
    var allowed = s.radius + Math.min(accuracy, ACCURACY_BONUS_M);
    if (distance > allowed) {
      log(point, "далеко", distance);
      return { ok: false, far: true, distance: Math.round(distance), radius: s.radius, cp: cpId };
    }

    log(point, OK, distance);
    CacheService.getScriptCache().remove("public");
    return { cp: cpId, value: point.value, distance: Math.round(distance), at: Date.now() };
  });
}

/* ================= данные ================= */

function settings_() {
  var rows = sheet_("settings").getDataRange().getValues();
  var map = {};
  rows.forEach(function (r) { map[String(r[0]).trim()] = r[1]; });
  var start = map["Старт"] instanceof Date ? map["Старт"].getTime() : Date.parse(String(map["Старт"]));
  if (!isFinite(start)) throw userError_("Сервер не настроен: в «Настройках» неверное время старта");
  var change = map["Повышение цены"];
  change = change instanceof Date ? change.getTime() : Date.parse(String(change));
  return {
    start: start,
    radius: Number(map["Радиус, м"]) || 150,
    site: String(map["Адрес сайта"] || "").trim(),
    priceEarly: Number(map["Цена, ₽"]) || 0,
    priceLate: Number(map["Цена после повышения, ₽"]) || Number(map["Цена, ₽"]) || 0,
    priceChange: isFinite(change) ? change : Infinity,
    requirePaid: YES.test(String(map["Гонка только после оплаты"] || "").trim()),
  };
}

function readPoints_() {
  return rows_("points")
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      return {
        id: String(r[0]).trim(),
        name: String(r[1]).trim(),
        address: String(r[2]).trim(),
        lat: Number(r[3]),
        lng: Number(r[4]),
        value: Number(r[5]) || 1,
        final: YES.test(String(r[6]).trim()),
        secret: String(r[7]).trim(),
      };
    });
}

function publicPoint_(p) {
  return { id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng, value: p.value, final: p.final };
}

function readScans_() {
  return rows_("scans")
    .filter(function (r) { return r[6] === OK; })
    .map(function (r) {
      return { at: new Date(r[0]).getTime(), nick: String(r[1]), cp: String(r[2]) };
    });
}

function findRegistration_(nick) {
  var row = rows_("regs").filter(function (r) { return cleanNick_(r[1]) === nick; })[0];
  if (!row) return null;
  return {
    nick: nick,
    amount: Number(row[4]) || 0,
    paid: row[5] === true || YES.test(String(row[5]).trim()),
    blocked: /^(нет|no|0|false)$/i.test(String(row[6]).trim()),
  };
}

// очки = сумма ценности точек; при равенстве выше тот, кто набрал их раньше
function leaderboard_(points, scans) {
  var value = {};
  points.forEach(function (p) { value[p.id] = p.value; });
  var byNick = {};
  scans.forEach(function (x) {
    if (!(x.cp in value)) return;
    var r = byNick[x.nick] || (byNick[x.nick] = { nick: x.nick, score: 0, reachedAt: 0, scans: [] });
    r.score += value[x.cp];
    r.reachedAt = Math.max(r.reachedAt, x.at);
    r.scans.push([x.cp, x.at]);
  });
  return Object.keys(byNick)
    .map(function (k) { return byNick[k]; })
    .sort(function (a, b) { return b.score - a.score || a.reachedAt - b.reachedAt; });
}

/* ================= утилиты ================= */

function cleanNick_(v) {
  var nick = String(v || "").trim().toLowerCase()
    .replace(/^https?:\/\/t\.me\//, "")
    .replace(/^@/, "");
  return /^[a-z0-9_]{3,32}$/.test(nick) ? nick : "";
}

function distanceM_(a, b) {
  var rad = function (x) { return (x * Math.PI) / 180; };
  var dLat = rad(b.lat - a.lat);
  var dLng = rad(b.lng - a.lng);
  var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.pow(Math.sin(dLng / 2), 2);
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw userError_("Сервер занят, попробуй ещё раз через пару секунд");
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function sheet_(key) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS[key]);
  if (!sh) throw userError_("Сервер не настроен: нет листа «" + SHEETS[key] + "». Запустите функцию setup в Apps Script");
  return sh;
}

function rows_(key) {
  var sh = sheet_(key);
  var n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, sh.getLastColumn()).getValues() : [];
}

/* ================= меню организатора ================= */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Аллейкат")
    .addItem("Первичная настройка", "setup")
    .addItem("Обновить ссылки и QR точек", "refreshQr")
    .addToUi();
}

/** Создаёт листы с заголовками и примером точек. Существующие данные не трогает. */
function setup() {
  var ss = SpreadsheetApp.getActive();
  var ensure = function (name, header) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (header && sh.getLastRow() === 0) {
      sh.appendRow(header);
      sh.getRange(1, 1, 1, header.length).setFontWeight("bold");
      sh.setFrozenRows(1);
    }
    return sh;
  };

  // дописываем недостающие настройки, существующие значения не трогаем
  var st = ensure(SHEETS.settings);
  var have = st.getLastRow() ? st.getRange(1, 1, st.getLastRow(), 1).getValues().map(function (r) { return String(r[0]).trim(); }) : [];
  DEFAULT_SETTINGS.forEach(function (row) {
    if (have.indexOf(row[0]) >= 0) return;
    st.getRange(st.getLastRow() + 1, 1, 1, 2).setNumberFormat("@").setValues([row]);
    st.getRange(st.getLastRow(), 1).setFontWeight("bold");
  });
  st.autoResizeColumns(1, 2);

  ensure(SHEETS.regs, HEADERS.regs);
  ensure(SHEETS.scans, HEADERS.scans);
  var pts = ensure(SHEETS.points, HEADERS.points);
  if (pts.getLastRow() === 1) {
    pts.getRange(2, 1, 3, 7).setValues([
      ["c1", "Пример: мост", "Набережная, 1", 55.752, 37.6175, 1, ""],
      ["c2", "Пример: смотровая", "Лесная, 27", 55.765, 37.598, 2, ""],
      ["fin", "bass_u x werk", "Клуб · награждение и туса", 55.7555, 37.632, 5, "да"],
    ]);
  }
  refreshQr();

  // ответы Google Формы → «Регистрации»: сразу и при каждом новом ответе
  importFormResponses();
  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "importFormResponses"; });
  if (formSheet_() && !hasTrigger) ScriptApp.newTrigger("importFormResponses").forSpreadsheet(ss).onFormSubmit().create();
}

/* ================= ответы Google Формы ================= */

// лист, куда Google Форма пишет ответы: «Время | ник | пол | источник оплаты»
function formSheet_() {
  return SpreadsheetApp.getActive().getSheets().filter(function (sh) {
    return /^(Ответы на форму|Form Responses)/i.test(sh.getName());
  })[0] || null;
}

/**
 * Переносит новые ответы формы в «Регистрации» (каждый — один раз).
 * Ник, который не похож на ник в Telegram, переносится как есть —
 * поправьте его вручную в «Регистрациях», иначе человек не сможет войти.
 */
function importFormResponses() {
  var form = formSheet_();
  if (!form) return;
  withLock_(function () {
    var props = PropertiesService.getScriptProperties();
    var done = Number(props.getProperty("formRowsImported")) || 1; // строка 1 — заголовки
    var last = form.getLastRow();
    if (last <= done) return;
    var s = settings_();
    form.getRange(done + 1, 1, last - done, 4).getValues().forEach(function (r) {
      var raw = String(r[1]).trim();
      if (!raw) return;
      var nick = cleanNick_(raw) || raw;
      if (cleanNick_(raw) && findRegistration_(nick)) return; // уже есть, например с сайта
      var gender = /^ж/i.test(String(r[2]).trim()) ? "Ж" : "М";
      var time = r[0] instanceof Date ? r[0] : new Date();
      addRegistration_(s, time, nick, gender, String(r[3]).trim());
    });
    props.setProperty("formRowsImported", String(last));
  });
}

/** Дозаполняет секреты, ссылки для QR и картинки QR у всех точек. */
function refreshQr() {
  var site = settings_().site.replace(/\/?$/, "/");
  var sh = sheet_("points");
  var n = sh.getLastRow() - 1;
  if (n < 1) return;
  var range = sh.getRange(2, 1, n, HEADERS.points.length);
  var rows = range.getValues();
  rows.forEach(function (r, i) {
    if (!String(r[0]).trim()) return;
    if (!String(r[7]).trim()) r[7] = Utilities.getUuid().replace(/-/g, "").slice(0, 12);
    r[8] = site + "?cp=" + encodeURIComponent(String(r[0]).trim()) + "&k=" + r[7];
    r[9] = '=IMAGE("https://quickchart.io/qr?size=300&margin=1&text=" & ENCODEURL(I' + (i + 2) + "))";
  });
  range.setValues(rows);
  sh.setRowHeights(2, n, 120);
  sh.setColumnWidth(10, 130);
}
