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
