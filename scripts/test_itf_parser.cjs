// Test analizatora importu ITF z docs/admin.html. Uruchomienie: node scripts/test_itf_parser.cjs
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "docs", "admin.html"), "utf8");
const a = html.indexOf("const MONTHS");
const b = html.indexOf("let itfRows");
const { parseItf } = new Function(html.slice(a, b) + ";return { parseItf };")();

let failed = 0;
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : `\n   oczekiwano: ${JSON.stringify(expected)}\n   jest:       ${JSON.stringify(actual)}`));
}
const one = (text) => parseItf(text, 2026).map((r) => [r.name, r.city, r.country, r.from, r.to, r.category]);

eq("polski blok, miesiac przechodzi w nastepny", one("J300 Repentigny\n29 sierpnia do 4 września 2026 r.\nKanada\nRepentigny\nJ300\nNa zewnątrz\n-\nTrudne"),
  [["J300 Repentigny", "Repentigny", "Kanada", "2026-08-29", "2026-09-04", "J300"]]);
eq("polskie znaki w miescie i nazwie", one("J30 Szczawno Zdrój\n08 września do 12 września 2026 r.\nPolska\nSzczawno Zdrój\nJ30"),
  [["J30 Szczawno Zdrój", "Szczawno Zdrój", "Polska", "2026-09-08", "2026-09-12", "J30"]]);
eq("kategoria JGS (US Open juniorow)", one("Mistrzostwa tenisowe US Open Juniorów\n06 września do 12 września 2026 r.\nUSA\nNowy Jork\nJGS"),
  [["Mistrzostwa tenisowe US Open Juniorów", "Nowy Jork", "USA", "2026-09-06", "2026-09-12", "JGS"]]);
eq("listopad na grudzien, pazdziernik", one("J60 Test\n30 października do 5 listopada 2026 r.\nPolska\nWarszawa\nJ60"),
  [["J60 Test", "Warszawa", "Polska", "2026-10-30", "2026-11-05", "J60"]]);
eq("przelom roku (grudzien do styczen)", one("J30 Nowy Rok\n28 grudnia do 3 stycznia 2027 r.\nPolska\nKraków\nJ30"),
  [["J30 Nowy Rok", "Kraków", "Polska", "2026-12-28", "2027-01-03", "J30"]]);
eq("naglowek z zakresem dat bez kategorii jest pomijany", one("Od 1 września 2026 r. do 30 września 2026 r.Wszystkie formaty losowania\nNazwa\nData"), []);
eq("format angielski", one("J60 Dijon\n31 Aug to 05 Sep 2026\nFrance\nDijon\nJ60"),
  [["J60 Dijon", "Dijon", "France", "2026-08-31", "2026-09-05", "J60"]]);
eq("wiersz ze srednikami", one("Puchar Zabrza; Zabrze; Polska; 2026-10-05; 2026-10-11; J100"),
  [["Puchar Zabrza", "Zabrze", "Polska", "2026-10-05", "2026-10-11", "J100"]]);
eq("duplikat tego samego turnieju liczy sie raz", one("J30 A\n01 września do 05 września 2026 r.\nPolska\nX\nJ30\nJ30 A\n01 września do 05 września 2026 r.\nPolska\nX\nJ30").length, 1);
eq("pusty tekst", one(""), []);
eq("smieci bez dat", one("Zapisać się\nWycieczki\nJuniorzy World Tennis Tour"), []);
eq("data bez bloku (brak linii z kategoria)", one("Jakis naglowek\n01 września do 05 września 2026 r.\nPolska\nX"), []);
console.log(failed === 0 ? "\nWszystkie testy przeszly" : `\n${failed} testow nie przeszlo`);
process.exit(failed ? 1 : 0);
