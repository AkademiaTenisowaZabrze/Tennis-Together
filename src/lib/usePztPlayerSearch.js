import { supabase } from "./supabase.js";

// Usuwa polskie znaki + normalizuje wielkość liter/spacje — ten sam wzorzec
// co w useCityCoordinates.js (dopasowanie odporne na literówki/ogonki).
function normalizeName(name) {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/ą/g, "a")
    .replace(/ć/g, "c")
    .replace(/ę/g, "e")
    .replace(/ł/g, "l")
    .replace(/ń/g, "n")
    .replace(/ó/g, "o")
    .replace(/ś/g, "s")
    .replace(/ź/g, "z")
    .replace(/ż/g, "z");
}

// "Zgadza się" = każde słowo z imienia/nazwiska podanego w profilu
// występuje też w nazwie zwróconej live przez PZT (portal zwraca format
// "Nazwisko Imię", więc porównujemy zbiór słów, nie kolejność).
function namesMatch(firstName, lastName, pztName) {
  const formWords = new Set(
    normalizeName(`${firstName} ${lastName}`)
      .split(/\s+/)
      .filter(Boolean)
  );
  const pztWords = normalizeName(pztName).split(/\s+/).filter(Boolean);
  return pztWords.length > 0 && pztWords.every((w) => formWords.has(w));
}

// Weryfikacja zawodnika przez login PZT (PLAN.md, "z kim ja właściwie
// jadę") — wywołuje Edge Function pzt-player-lookup (zastępuje martwy
// Railway, patrz supabase/functions/pzt-player-lookup/index.ts), która
// scrapuje portal.pzt.pl bezpośrednio i zwraca prawdziwe imię i nazwisko
// przypisane do tego loginu, do porównania z tym, co rodzic wpisał
// w profilu zawodnika.
//
// (Wyszukiwanie turniejów po nazwisku zawodnika — dawne "Znajdź turniej po
// zawodniku" w TournamentsPage.jsx — zostało usunięte 2026-09-27: wymagało
// martwego backendu Railway i indeksu całego archiwum zawodników PZT.)
export async function verifyPztLogin(login, firstName, lastName) {
  const { data, error } = await supabase.functions.invoke("pzt-player-lookup", {
    body: { login },
  });
  if (error) throw new Error("Serwer PZT odpowiedział błędem — spróbuj ponownie za chwilę.");
  if (!data?.player_name) {
    return { found: false, pztName: null, matches: false };
  }
  return { found: true, pztName: data.player_name, matches: namesMatch(firstName, lastName, data.player_name) };
}
