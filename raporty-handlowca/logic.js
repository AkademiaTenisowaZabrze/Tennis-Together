/* Logika bez DOM: harmonogram telefonów, import z Excela, statystyki.
   Ładowana jako zwykły skrypt w przeglądarce (window.Logic) oraz przez require() w testach. */
(function (root) {
  'use strict';

  var CONFIG = { callDays: [1, 3, 5], maxAttempts: 6, repeatDays: 7 }; // pon, śr, pt; co tydzień; max 6 prób

  var RESULTS = {
    nie_odebral: 'Nie odebrał',
    oddzwonic: 'Oddzwonić',
    zainteresowany: 'Zainteresowany',
    spotkanie: 'Umówione spotkanie',
    nie_zainteresowany: 'Nie zainteresowany'
  };
  var STATUSES = {
    nowy: 'Nowy',
    w_toku: 'W toku',
    zainteresowany: 'Zainteresowany',
    umowiony: 'Umówiony',
    do_rezygnacji: 'Do rezygnacji',
    zrezygnowano: 'Zrezygnowano'
  };
  var ACTIVE = ['nowy', 'w_toku', 'zainteresowany', 'umowiony'];

  // ---- daty (łańcuchy YYYY-MM-DD, liczone w czasie lokalnym) ----
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function fmt(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function today() { return fmt(new Date()); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }
  function isCallDay(s, cfg) { return (cfg || CONFIG).callDays.indexOf(parse(s).getDay()) !== -1; }
  /** Pierwszy dzień >= s, w który się dzwoni. */
  function nextCallDay(s, cfg) {
    var i = 0;
    while (!isCallDay(s, cfg) && i++ < 7) s = addDays(s, 1);
    return s;
  }
  var DAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
  function dayName(s) { return DAYS[parse(s).getDay()]; }

  // ---- reguły rozmowy ----
  /** Zwraca nową wersję kontaktu po zapisaniu rozmowy. opts.nastepny = data wybrana ręcznie. */
  function applyCall(contact, wynik, dateStr, opts, cfg) {
    cfg = cfg || CONFIG; opts = opts || {};
    var c = Object.assign({}, contact);
    var weekLater = nextCallDay(addDays(dateStr, cfg.repeatDays), cfg);
    c.ostatni = dateStr;
    if (wynik === 'nie_odebral') {
      c.proby = (c.proby || 0) + 1;
      if (c.proby >= cfg.maxAttempts) { c.status = 'do_rezygnacji'; c.nastepny = null; }
      else { c.status = 'w_toku'; c.nastepny = weekLater; }
    } else if (wynik === 'oddzwonic') {
      c.status = 'w_toku'; c.nastepny = opts.nastepny || weekLater;
    } else if (wynik === 'zainteresowany') {
      c.status = 'zainteresowany'; c.nastepny = opts.nastepny || weekLater;
    } else if (wynik === 'spotkanie') {
      c.status = 'umowiony'; c.nastepny = opts.nastepny || null;
    } else if (wynik === 'nie_zainteresowany') {
      c.status = 'do_rezygnacji'; c.nastepny = null;
    } else {
      throw new Error('Nieznany wynik: ' + wynik);
    }
    return c;
  }

  /** Kolejka na dziś: {zalegle, dzis, nowe}. Nowych kontaktów (bez terminu) nie ma w "dzis"; pokazujemy je w dni telefonów. */
  function queue(contacts, todayStr, cfg) {
    var zalegle = [], dzis = [], nowe = [];
    contacts.forEach(function (c) {
      if (ACTIVE.indexOf(c.status) === -1) return;
      if (c.nastepny) {
        if (c.nastepny < todayStr) zalegle.push(c);
        else if (c.nastepny === todayStr) dzis.push(c);
      } else if (c.status === 'nowy') nowe.push(c);
    });
    var byDate = function (a, b) { return a.nastepny < b.nastepny ? -1 : a.nastepny > b.nastepny ? 1 : 0; };
    zalegle.sort(byDate);
    return { zalegle: zalegle, dzis: dzis, nowe: nowe, dzienTelefonow: isCallDay(todayStr, cfg) };
  }

  // ---- statystyki ----
  function stats(calls, from, to) {
    var out = { razem: 0 }; Object.keys(RESULTS).forEach(function (k) { out[k] = 0; });
    calls.forEach(function (x) {
      if (x.data < from || x.data > to) return;
      out.razem++; out[x.wynik]++;
    });
    return out;
  }
  function weekStart(s) { var d = parse(s).getDay(); return addDays(s, -((d + 6) % 7)); }

  // ---- import z Excela ----
  var SYN = {
    firma: ['firma', 'nazwa', 'nazwa firmy', 'klient', 'spolka', 'przedsiebiorstwo', 'company'],
    imie: ['imie', 'first name'],
    nazwisko: ['nazwisko', 'last name'],
    osoba: ['osoba', 'kontakt', 'osoba kontaktowa', 'imie i nazwisko', 'dane kontaktowe', 'opiekun', 'contact'],
    telefon: ['telefon', 'tel', 'tel.', 'nr telefonu', 'numer telefonu', 'numer', 'komorka', 'telefon komorkowy', 'phone', 'nr tel'],
    email: ['email', 'e-mail', 'mail', 'adres email', 'adres e-mail'],
    miasto: ['miasto', 'miejscowosc', 'city'],
    uwagi: ['uwagi', 'notatka', 'notatki', 'komentarz', 'opis', 'informacje']
  };
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/ł/g, 'l').replace(/\s+/g, ' ').trim();
  }
  function phoneKey(s) { var d = String(s || '').replace(/\D/g, ''); return d.length > 9 ? d.slice(-9) : d; }

  /** rows = tablica tablic (arkusz jako AoA). Pierwszy niepusty wiersz to nagłówki. */
  function parseSheet(rows) {
    var h = 0;
    while (h < rows.length && !rows[h].some(function (v) { return String(v).trim() !== ''; })) h++;
    if (h >= rows.length) return { contacts: [], mapping: {}, extraCols: [] };
    var heads = rows[h].map(function (v) { return String(v == null ? '' : v).trim(); });
    var map = {}, used = {};
    heads.forEach(function (name, i) {
      var n = norm(name);
      Object.keys(SYN).forEach(function (f) {
        if (map[f] === undefined && SYN[f].indexOf(n) !== -1) { map[f] = i; used[i] = true; }
      });
    });
    var extraCols = [];
    heads.forEach(function (name, i) { if (!used[i] && name) extraCols.push(i); });
    var contacts = [];
    for (var r = h + 1; r < rows.length; r++) {
      var row = rows[r], g = function (f) { return map[f] === undefined ? '' : String(row[map[f]] == null ? '' : row[map[f]]).trim(); };
      var osoba = g('osoba') || [g('imie'), g('nazwisko')].filter(Boolean).join(' ');
      var c = { firma: g('firma'), osoba: osoba, telefon: g('telefon'), email: g('email'), miasto: g('miasto'), uwagi: g('uwagi'), extra: {} };
      extraCols.forEach(function (i) { var v = row[i]; if (v !== undefined && String(v).trim() !== '') c.extra[heads[i]] = String(v).trim(); });
      if (!c.firma && !c.osoba && !c.telefon) continue;
      contacts.push(c);
    }
    var mapping = {}; Object.keys(map).forEach(function (f) { mapping[f] = heads[map[f]]; });
    return { contacts: contacts, mapping: mapping, extraCols: extraCols.map(function (i) { return heads[i]; }) };
  }

  function contactKey(c) { return phoneKey(c.telefon) || norm(c.firma + '|' + c.osoba); }

  /** Dopisuje nowe kontakty, pomija duplikaty (po numerze telefonu). Zwraca {added, skipped}. */
  function mergeImport(existing, imported, makeId) {
    var seen = {}; existing.forEach(function (c) { seen[contactKey(c)] = true; });
    var added = [], skipped = 0;
    imported.forEach(function (c) {
      var k = contactKey(c);
      if (seen[k]) { skipped++; return; }
      seen[k] = true;
      added.push(Object.assign({ id: makeId(), status: 'nowy', proby: 0, nastepny: null, ostatni: null }, c));
    });
    return { added: added, skipped: skipped };
  }

  var api = {
    CONFIG: CONFIG, RESULTS: RESULTS, STATUSES: STATUSES, ACTIVE: ACTIVE,
    today: today, addDays: addDays, isCallDay: isCallDay, nextCallDay: nextCallDay, dayName: dayName, weekStart: weekStart,
    applyCall: applyCall, queue: queue, stats: stats, parseSheet: parseSheet, mergeImport: mergeImport, norm: norm
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);
