(function () {
  'use strict';
  var L = window.Logic, KEY = 'raporty-handlowca-v1';
  var state = { contacts: [], calls: [] };
  var ui = { tab: 'today', filter: 'all', q: '', limit: 30, period: 'week', histLimit: 40, open: null };
  var $ = function (s) { return document.querySelector(s); };

  // ---------- zapis ----------
  function load() {
    try { var d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d) state = d; } catch (e) { toast('Nie udało się odczytać danych', true); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('Nie można zapisać danych (brak miejsca?). Zrób kopię zapasową.', true); }
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg, err) {
    var t = $('#toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 7000);
  }
  function pl(d) { return d ? d.split('-').reverse().join('.') : '–'; }
  function byId(id) { return state.contacts.filter(function (c) { return c.id === id; })[0]; }

  // ---------- widoki ----------
  function contactItem(c, opts) {
    opts = opts || {};
    var late = c.nastepny && c.nastepny < L.today();
    var st = c.status === 'do_rezygnacji' ? 'err' : (c.status === 'umowiony' ? 'ok' : '');
    var h = '<div class="item' + (late ? ' late' : '') + '" data-id="' + c.id + '"><div class="name"><b>' + esc(c.firma || c.osoba || '(bez nazwy)') + '</b>' +
      '<small>' + esc([c.firma ? c.osoba : '', c.miasto, c.adres].filter(Boolean).join(' · ')) + '</small>' +
      '<small>' + (c.telefon ? '<a href="tel:' + esc(c.telefon.replace(/[^\d+]/g, '')) + '">' + esc(c.telefon) + '</a> · ' : '') +
      '<span class="badge ' + st + '">' + L.STATUSES[c.status] + '</span> próby: ' + (c.proby || 0) + '/' + L.CONFIG.maxAttempts +
      (c.nastepny ? ' · następny: ' + pl(c.nastepny) + ' (' + L.dayName(c.nastepny) + ')' : '') + '</small>' +
      (c.uwagi ? '<small>' + esc(c.uwagi) + '</small>' : '') + '</div><div class="acts">';
    if (opts.resign) {
      h += '<button class="danger" data-act="resign">Zrezygnuj</button><button data-act="back">Wróć do kolejki</button>';
    } else {
      h += '<button class="ico" data-act="hist" aria-label="Historia rozmów">🗒️</button><button class="primary" style="width:auto;min-height:40px" data-act="call">Zapisz rozmowę</button>';
    }
    return h + '</div></div>';
  }
  function section(title, list, opts) {
    if (!list.length) return '';
    return '<h2>' + title + ' (' + list.length + ')</h2>' + list.map(function (c) { return contactItem(c, opts); }).join('');
  }

  function viewToday() {
    var t = L.today(), q = L.queue(state.contacts, t);
    var resign = state.contacts.filter(function (c) { return c.status === 'do_rezygnacji'; });
    var h = '<h1>Dziś</h1><p class="sub">' + L.dayName(t) + ', ' + pl(t) + (q.dzienTelefonow ? ' · dzień telefonów' : ' · dziś nie jest dzień telefonów (pon, śr, pt)') + '</p>';
    if (!state.contacts.length) return h + '<p class="empty">Brak kontaktów. Otwórz menu (☰) i wczytaj portfel z Excela.</p>';
    h += section('Zaległe', q.zalegle) + section('Na dziś', q.dzis);
    if (q.dzienTelefonow || !q.zalegle.length && !q.dzis.length) h += section('Nowe kontakty', q.nowe.slice(0, 15));
    if (q.nowe.length > 15 && (q.dzienTelefonow)) h += '<p class="hint">Pokazano 15 z ' + q.nowe.length + ' nowych kontaktów. Resztę znajdziesz w Portfelu.</p>';
    h += section('Do rezygnacji – decyzja', resign, { resign: true });
    if (!q.zalegle.length && !q.dzis.length && !q.nowe.length && !resign.length) h += '<p class="empty">Na dziś nic do zrobienia.</p>';
    return h;
  }

  function viewPortfolio() {
    var chips = [['all', 'Wszystkie']].concat(Object.keys(L.STATUSES).map(function (k) { return [k, L.STATUSES[k]]; }));
    var q = L.norm(ui.q);
    var list = state.contacts.filter(function (c) {
      if (ui.filter !== 'all' && c.status !== ui.filter) return false;
      return !q || L.norm([c.firma, c.osoba, c.telefon, c.miasto, c.email].join(' ')).indexOf(q) !== -1;
    });
    var h = '<h1>Portfel</h1><p class="sub">' + state.contacts.length + ' kontaktów</p><input type="search" id="q" placeholder="Szukaj: firma, osoba, telefon, miasto" aria-label="Szukaj" value="' + esc(ui.q) + '">' +
      '<div class="chips">' + chips.map(function (c) { return '<button class="chip' + (ui.filter === c[0] ? ' on' : '') + '" data-filter="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div>';
    if (!list.length) return h + '<p class="empty">Brak kontaktów dla tego filtra.</p>';
    h += list.slice(0, ui.limit).map(function (c) { return contactItem(c); }).join('');
    if (list.length > ui.limit) h += '<button class="wide" id="more">Pokaż więcej (' + (list.length - ui.limit) + ')</button>';
    return h;
  }

  function callName(x) { var c = byId(x.contactId); return c ? (c.firma || c.osoba) : '(usunięty kontakt)'; }
  function viewHistory(contactId) {
    var q = L.norm(ui.q), calls = state.calls.slice().reverse().filter(function (x) {
      if (contactId) return x.contactId === contactId;
      return !q || L.norm(callName(x) + ' ' + x.notka).indexOf(q) !== -1;
    });
    var h = '<h1>Historia rozmów</h1><p class="sub">' + (contactId ? esc(callName({ contactId: contactId })) + ' · <a href="#" id="allHist">pokaż wszystkie</a>' : 'Do kogo dzwoniłem, kiedy i z jakim skutkiem') + '</p>' +
      (contactId ? '' : '<input type="search" id="q" placeholder="Szukaj w historii" aria-label="Szukaj" value="' + esc(ui.q) + '">');
    if (!calls.length) return h + '<p class="empty">Brak zapisanych rozmów.</p>';
    h += calls.slice(0, ui.histLimit).map(function (x) {
      var ok = x.wynik === 'spotkanie' || x.wynik === 'zainteresowany', bad = x.wynik === 'nie_zainteresowany';
      return '<div class="item"><div class="name"><b>' + esc(callName(x)) + '</b><small>' + pl(x.data) + ' (' + L.dayName(x.data) + ') ' + esc(x.godzina || '') +
        ' · <span class="badge ' + (ok ? 'ok' : bad ? 'err' : '') + '">' + L.RESULTS[x.wynik] + '</span> próba nr ' + (x.proba || '–') + '</small>' +
        (x.notka ? '<p class="note">' + esc(x.notka) + '</p>' : '') + '</div></div>';
    }).join('');
    if (calls.length > ui.histLimit) h += '<button class="wide" id="moreH">Pokaż więcej (' + (calls.length - ui.histLimit) + ')</button>';
    return h;
  }

  function range() {
    var t = L.today();
    if (ui.period === 'day') return [t, t, 'Dziś'];
    if (ui.period === 'week') { var w = L.weekStart(t); return [w, L.addDays(w, 6), 'Ten tydzień']; }
    if (ui.period === 'month') return [t.slice(0, 8) + '01', t.slice(0, 8) + '31', 'Ten miesiąc'];
    return ['0000-00-00', '9999-99-99', 'Całość'];
  }
  function viewReport() {
    var r = range(), s = L.stats(state.calls, r[0], r[1]);
    var per = [['day', 'Dziś'], ['week', 'Tydzień'], ['month', 'Miesiąc'], ['all', 'Całość']];
    var h = '<h1>Raport</h1><p class="sub">' + r[2] + '</p><div class="chips">' + per.map(function (p) {
      return '<button class="chip' + (ui.period === p[0] ? ' on' : '') + '" data-period="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<div class="stats"><div class="stat"><b>' + s.razem + '</b><span>wykonanych telefonów</span></div>' +
      Object.keys(L.RESULTS).map(function (k) { return '<div class="stat"><b>' + s[k] + '</b><span>' + L.RESULTS[k] + '</span></div>'; }).join('') + '</div>';
    var stc = {}; state.contacts.forEach(function (c) { stc[c.status] = (stc[c.status] || 0) + 1; });
    h += '<h2>Stan portfela</h2><div class="stats">' + Object.keys(L.STATUSES).map(function (k) {
      return '<div class="stat"><b>' + (stc[k] || 0) + '</b><span>' + L.STATUSES[k] + '</span></div>'; }).join('') + '</div>';
    return h + '<button class="wide" id="btnExport2">📤 Eksportuj raport do Excela</button>';
  }

  function render() {
    var v = $('#view');
    v.innerHTML = ui.tab === 'today' ? viewToday() : ui.tab === 'portfolio' ? viewPortfolio() :
      ui.tab === 'history' ? viewHistory(ui.open) : viewReport();
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === ui.tab); });
    var q = $('#q'); if (q) q.addEventListener('input', function () {
      ui.q = q.value; var pos = q.selectionStart; render(); var n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
  }
  function setTab(t) { ui.tab = t; ui.open = null; ui.limit = 30; ui.histLimit = 40; render(); window.scrollTo(0, 0); }

  // ---------- rozmowa ----------
  var cur = null, curResult = null;
  function openCall(id) {
    cur = byId(id); curResult = null;
    $('#callTitle').textContent = cur.firma || cur.osoba;
    $('#callSub').textContent = [cur.osoba && cur.firma ? cur.osoba : '', cur.telefon].filter(Boolean).join(' · ') + ' · próba ' + ((cur.proby || 0) + 1) + ' z ' + L.CONFIG.maxAttempts;
    $('#callNote').value = ''; $('#nextWrap').hidden = true;
    $('#resultChips').innerHTML = Object.keys(L.RESULTS).map(function (k) { return '<button type="button" class="chip" data-res="' + k + '">' + L.RESULTS[k] + '</button>'; }).join('');
    $('#callDlg').showModal();
  }
  function pickResult(k) {
    curResult = k;
    document.querySelectorAll('#resultChips .chip').forEach(function (b) { b.classList.toggle('on', b.dataset.res === k); });
    var t = L.today(), w = $('#nextWrap'), show = ['oddzwonic', 'zainteresowany', 'spotkanie'].indexOf(k) !== -1;
    w.hidden = !show;
    $('#nextLabel').textContent = k === 'spotkanie' ? 'Data spotkania (opcjonalnie)' : 'Następny telefon';
    $('#nextDate').value = k === 'spotkanie' ? '' : L.nextCallDay(L.addDays(t, L.CONFIG.repeatDays));
  }
  function saveCall(ev) {
    ev.preventDefault();
    if (!curResult) { toast('Wybierz wynik rozmowy', true); return; }
    var now = new Date(), t = L.today(), next = $('#nextWrap').hidden ? null : ($('#nextDate').value || null);
    var upd = L.applyCall(cur, curResult, t, { nastepny: next });
    state.calls.push({ id: uid(), contactId: cur.id, data: t, godzina: now.toTimeString().slice(0, 5), wynik: curResult,
      notka: $('#callNote').value.trim(), proba: (cur.proby || 0) + (curResult === 'nie_odebral' ? 1 : 0) || 1 });
    state.contacts[state.contacts.indexOf(cur)] = upd;
    save(); $('#callDlg').close();
    var msg = 'Zapisano.';
    if (upd.status === 'do_rezygnacji') msg += curResult === 'nie_odebral' ? ' To była ' + L.CONFIG.maxAttempts + '. próba – zdecyduj o rezygnacji.' : ' Zdecyduj o rezygnacji.';
    else if (upd.nastepny) msg += ' Następny telefon: ' + pl(upd.nastepny) + ' (' + L.dayName(upd.nastepny) + ').';
    toast(msg); render(); badge();
  }
  function badge() {
    var q = L.queue(state.contacts, L.today()), n = state.contacts.filter(function (c) { return c.status === 'do_rezygnacji'; }).length;
    $('#menuBtn').classList.toggle('rec', false);
    document.title = (q.zalegle.length + q.dzis.length + n ? '(' + (q.zalegle.length + q.dzis.length + n) + ') ' : '') + 'Raporty handlowca';
  }

  // ---------- import / eksport ----------
  /** Arkusz z najwięcej wierszami (w pliku bywają arkusze pomocnicze, np. listy wartości). */
  function pickSheet(wb) {
    var best = wb.SheetNames[0], n = -1;
    wb.SheetNames.forEach(function (name) { var ref = wb.Sheets[name]['!ref']; if (!ref) return; var rows = XLSX.utils.decode_range(ref).e.r; if (rows > n && XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }).some(function (r) { return r.length; })) { n = rows; best = name; } });
    return best;
  }
  function importFile(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var wb = XLSX.read(r.result, { type: 'array' }), ws = wb.Sheets[pickSheet(wb)];
        var p = L.parseSheet(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }));
        if (!p.mapping.telefon) { toast('Nie znalazłem kolumny z telefonem. Nagłówek powinien brzmieć np. „Telefon” lub „Tel.”', true); return; }
        var m = L.mergeImport(state.contacts, p.contacts, uid, L.today());
        state.contacts = state.contacts.concat(m.added); save(); closeDrawer(); setTab('portfolio');
        toast('Dodano ' + m.added.length + ' kontaktów, pominięto duplikatów: ' + m.skipped + '. Rozpoznane kolumny: ' + Object.keys(p.mapping).join(', ') + '.');
      } catch (e) { toast('Nie udało się wczytać pliku: ' + e.message, true); }
    };
    r.readAsArrayBuffer(file);
  }
  function exportReport() {
    var wb = XLSX.utils.book_new();
    var calls = state.calls.map(function (x) { var c = byId(x.contactId) || {};
      return { Data: x.data, Godzina: x.godzina, Dzień: L.dayName(x.data), Firma: c.firma || '', Osoba: c.osoba || '', Telefon: c.telefon || '',
        Wynik: L.RESULTS[x.wynik], 'Nr próby': x.proba, Notatka: x.notka }; });
    var port = state.contacts.map(function (c) { return Object.assign({ Firma: c.firma, Osoba: c.osoba, Telefon: c.telefon, Email: c.email, Miasto: c.miasto,
      Adres: c.adres || '', Status: L.STATUSES[c.status], Próby: c.proby || 0, 'Ostatni kontakt': c.ostatni || '', 'Następny telefon': c.nastepny || '', Uwagi: c.uwagi }, c.extra || {}); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(calls), 'Rozmowy');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(port), 'Portfel');
    XLSX.writeFile(wb, 'Raport handlowca ' + L.today() + '.xlsx'); toast('Raport zapisany');
  }
  function download(name, text) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click();
  }

  // ---------- szuflada ----------
  function openDrawer() { var d = $('#drawer'); d.inert = false; d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); $('#menuBtn').setAttribute('aria-expanded', 'true');
    var s = $('#drawerScrim'); s.hidden = false; requestAnimationFrame(function () { s.classList.add('open'); }); }
  function closeDrawer() { var d = $('#drawer'); d.classList.remove('open'); d.inert = true; d.setAttribute('aria-hidden', 'true'); $('#menuBtn').setAttribute('aria-expanded', 'false');
    var s = $('#drawerScrim'); s.classList.remove('open'); setTimeout(function () { s.hidden = true; }, 250); }

  // ---------- zdarzenia ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button, a'); if (!t) return;
    var item = t.closest('.item'), id = item && item.dataset.id;
    if (t.dataset.tab) return setTab(t.dataset.tab);
    if (t.dataset.filter) { ui.filter = t.dataset.filter; ui.limit = 30; return render(); }
    if (t.dataset.period) { ui.period = t.dataset.period; return render(); }
    if (t.dataset.res) return pickResult(t.dataset.res);
    var act = t.dataset.act;
    if (act === 'call') openCall(id);
    else if (act === 'hist') { ui.tab = 'history'; ui.open = id; render(); window.scrollTo(0, 0); }
    else if (act === 'resign') { if (confirm('Zrezygnować z tego kontaktu? Zostanie w portfelu ze statusem „Zrezygnowano”.')) { byId(id).status = 'zrezygnowano'; byId(id).nastepny = null; save(); render(); badge(); } }
    else if (act === 'back') { var c = byId(id); c.status = 'w_toku'; c.proby = 0; c.nastepny = L.nextCallDay(L.today()); save(); toast('Kontakt wrócił do kolejki'); render(); badge(); }
    if (t.id === 'more') { ui.limit += 30; render(); }
    if (t.id === 'moreH') { ui.histLimit += 40; render(); }
    if (t.id === 'allHist') { e.preventDefault(); ui.open = null; render(); }
    if (t.id === 'btnExport2' || t.id === 'btnExportReport') exportReport();
  });
  $('#menuBtn').addEventListener('click', openDrawer);
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerScrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('#drawer').classList.contains('open')) closeDrawer(); });
  $('#callForm').addEventListener('submit', saveCall);
  $('#callCancel').addEventListener('click', function () { $('#callDlg').close(); });
  $('#btnImport').addEventListener('click', function () { $('#fileImport').click(); });
  $('#fileImport').addEventListener('change', function (e) { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });
  $('#btnBackup').addEventListener('click', function () { download('kopia-handlowca-' + L.today() + '.json', JSON.stringify(state)); });
  $('#btnRestore').addEventListener('click', function () { $('#fileRestore').click(); });
  $('#fileRestore').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    if (!confirm('Przywrócenie kopii zastąpi wszystkie bieżące dane. Kontynuować?')) { e.target.value = ''; return; }
    f.text().then(function (txt) { var d = JSON.parse(txt); if (!d.contacts || !d.calls) throw new Error('to nie jest kopia aplikacji');
      state = d; save(); closeDrawer(); render(); badge(); toast('Przywrócono dane'); }).catch(function (er) { toast('Błąd kopii: ' + er.message, true); });
    e.target.value = '';
  });

  load(); render(); badge();
})();
