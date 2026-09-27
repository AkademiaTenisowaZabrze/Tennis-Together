// pzt-player-lookup — zastępuje martwy backend Railway
// (pzt-rankingi-api-production.up.railway.app, wyłączony przez limit kosztów
// darmowego planu — patrz git history projektu "NOWA APLIKACJA PZT ANDROID").
//
// Wywoływana NA ŻYWO z przeglądarki (formularz dodawania zawodnika,
// ProfilePage.jsx → verifyPztLogin) przy weryfikacji loginu PZT — sprawdza,
// czy pod danym loginem faktycznie widnieje osoba o podanym imieniu
// i nazwisku. Scrapuje portal.pzt.pl bezpośrednio, tym samym adresem co
// natywna apka "PZT Rankingi" (PlayerTournament.aspx?UserID=), ale bez
// pełnego parsowania DOM (Deno bez dodatkowej biblioteki go nie ma) —
// samo imię i nazwisko wystarczy wyciągnąć regexem.
//
// UWAGA: to NIE jest wyszukiwarka po nazwisku (/players/search) — tamta
// funkcja w sąsiednim projekcie buduje indeks z całego archiwum miesięcznych
// rankingów PZT i nie da się jej tu szybko odtworzyć. "Znajdź turniej po
// zawodniku" w TournamentsPage.jsx dalej wskazuje na martwy Railway i wymaga
// osobnej naprawy.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let login = "";
  try {
    const body = await req.json();
    login = String(body?.login ?? "").trim().toUpperCase();
  } catch {
    return jsonResponse({ error: "Nieprawidłowe zapytanie" }, 400);
  }
  if (!login) return jsonResponse({ error: "Brak loginu PZT" }, 400);

  const url = `https://portal.pzt.pl/PlayerTournament.aspx?UserID=${encodeURIComponent(login)}`;
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!res.ok) return jsonResponse({ error: `Portal PZT odpowiedział błędem ${res.status}` }, 502);
    html = await res.text();
  } catch (err) {
    console.error("pzt-player-lookup: błąd pobierania z PZT:", err);
    return jsonResponse({ error: "Brak połączenia z portalem PZT" }, 502);
  }

  // Ta sama klasa CSS, po której natywna apka wyciąga imię i nazwisko
  // (patrz pztPlayerUpcoming.js w projekcie PZT Android), tylko regexem
  // zamiast DOMParser — portal zwraca "Nazwisko Imię (LOGIN)".
  const m = /class="listBoxTxtShortTitle"[^>]*>([^<]+)</.exec(html);
  const rawName = m ? m[1].replace(/&nbsp;/g, " ").trim() : "";
  const playerName = rawName.replace(/\s*\([A-Z0-9]+\)\s*$/, "").trim();

  if (!playerName) return jsonResponse({ login, player_name: null, found: false });
  return jsonResponse({ login, player_name: playerName, found: true });
});
