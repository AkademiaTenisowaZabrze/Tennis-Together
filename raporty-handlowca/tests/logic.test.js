const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

test('dni telefonów: pon, śr, pt', () => {
  assert.equal(L.nextCallDay('2026-10-20'), '2026-10-21'); // wtorek -> środa
  assert.equal(L.nextCallDay('2026-10-22'), '2026-10-23'); // czwartek -> piątek
  assert.equal(L.nextCallDay('2026-10-24'), '2026-10-26'); // sobota -> poniedziałek
  assert.equal(L.nextCallDay('2026-10-21'), '2026-10-21');
});

test('nie odebrał: ponowny telefon za tydzień', () => {
  const c = L.applyCall({ status: 'nowy', proby: 0 }, 'nie_odebral', '2026-10-21');
  assert.equal(c.nastepny, '2026-10-28'); assert.equal(c.proby, 1); assert.equal(c.status, 'w_toku');
});

test('nie odebrał 6 razy: do rezygnacji', () => {
  let c = { status: 'nowy', proby: 0 }, d = '2026-10-21';
  for (let i = 0; i < 5; i++) { c = L.applyCall(c, 'nie_odebral', d); d = c.nastepny; assert.equal(c.status, 'w_toku'); }
  c = L.applyCall(c, 'nie_odebral', d);
  assert.equal(c.proby, 6); assert.equal(c.status, 'do_rezygnacji'); assert.equal(c.nastepny, null);
});

test('nie zainteresowany: do rezygnacji; oddzwonić: wybrana data', () => {
  assert.equal(L.applyCall({ proby: 0 }, 'nie_zainteresowany', '2026-10-21').status, 'do_rezygnacji');
  assert.equal(L.applyCall({ proby: 0 }, 'oddzwonic', '2026-10-21', { nastepny: '2026-11-02' }).nastepny, '2026-11-02');
});

test('kolejka: zaległe, dziś, nowe', () => {
  const q = L.queue([
    { id: 1, status: 'w_toku', nastepny: '2026-10-19' }, { id: 2, status: 'w_toku', nastepny: '2026-10-21' },
    { id: 3, status: 'nowy', nastepny: null }, { id: 4, status: 'w_toku', nastepny: '2026-10-28' },
    { id: 5, status: 'zrezygnowano', nastepny: '2026-10-19' }], '2026-10-21');
  assert.deepEqual([q.zalegle.length, q.dzis.length, q.nowe.length, q.dzienTelefonow], [1, 1, 1, true]);
});

test('import: rozpoznanie kolumn, dodatkowe pola, duplikaty', () => {
  const r = L.parseSheet([[], ['Nazwa firmy', 'Imię', 'Nazwisko', 'Tel.', 'Branża'], ['ABC', 'Jan', 'Kowalski', '600 100 200', 'IT'], ['', '', '', '', '']]);
  assert.equal(r.contacts.length, 1);
  assert.equal(r.contacts[0].osoba, 'Jan Kowalski'); assert.equal(r.contacts[0].extra['Branża'], 'IT');
  let n = 0; const m1 = L.mergeImport([], r.contacts, () => ++n);
  const m2 = L.mergeImport(m1.added, [{ firma: 'X', telefon: '+48 600-100-200' }], () => ++n);
  assert.equal(m1.added.length, 1); assert.equal(m2.skipped, 1);
});

test('import: układ prawdziwego portfela (nagłówki, daty, statusy)', () => {
  const head = ['Data pozyskania kontaktu', 'Kategoria obietu ', 'Nazwa klienta ', 'Osoba decyzyjna', 'Miejscowość ', 'Ulica', 'numer',
    'Telefon kontaktowy do osoby decyzyjnej', 'email', 'PH/APH', 'NAZWISKO I IMIĘ PH/APH', 'uwagi ', 'Data kolejnego kontaktu z klientem ', 'status', 'KATEGORIA KONTAKTU'];
  const r = L.parseSheet([head,
    ['2026/09/01', 'MAŁY BIZNES', 'Gabinet', 'Jarosław Kącki', 'Siemianowice', 'Wróbla ', '14d', '601-506-834', '', 'APH', 'Mesznik Paweł', 'Urlop', '', 'W TOKU', 'TEMAT W TOKU'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['2026/09/02', 'DOM', 'Kowalski', '', 'Zabrze', 'Długa', '2', '666300033', '', 'APH', 'Mesznik Paweł', '', '2026/10/26', 'REZYGNACJA', 'REZYGNACJA']]);
  assert.equal(r.contacts.length, 2);
  const c = r.contacts[0];
  assert.deepEqual([c.firma, c.osoba, c.telefon, c.adres, c.uwagi, c.status], ['Gabinet', 'Jarosław Kącki', '601-506-834', 'Wróbla 14d', 'Urlop', 'w_toku']);
  assert.equal(c.extra['KATEGORIA KONTAKTU'], 'TEMAT W TOKU');
  assert.equal(r.contacts[1].nastepny, '2026-10-26');
  let n = 0; const m = L.mergeImport([], r.contacts, () => ++n, '2026-10-22');
  assert.equal(m.added[0].nastepny, '2026-10-23'); // w toku bez terminu -> najbliższy dzień telefonu (piątek)
  assert.equal(m.added[1].status, 'zrezygnowano'); assert.equal(m.added[1].nastepny, null);
});
