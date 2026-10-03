// Bezpieczeństwo kodu webowego (XSS, nawigacja, zewnętrzne adresy) oraz
// kontrakty aplikacji: logotypy i linki, usunięte funkcje, rejestracja Service Workera.
import { describe, it, expect } from "vitest";
import { read, exists, filesUnder, lineOf } from "../helpers/repo.mjs";
import { itKnown } from "../helpers/known.js";

const SRC = filesUnder("src", /\.(js|jsx)$/);
const DOCS_HTML = filesUnder("docs", /\.html$/);

describe("kod React: niebezpieczne konstrukcje", () => {
  const sinks = [
    ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
    ["innerHTML", /\.innerHTML\s*=/],
    ["outerHTML", /\.outerHTML\s*=/],
    ["insertAdjacentHTML", /insertAdjacentHTML/],
    ["document.write", /document\.write\s*\(/],
    ["eval", /\beval\s*\(/],
    ["new Function", /new Function\s*\(/],
    ["javascript: w adresie", /["'`]javascript:/i],
    ["setTimeout z tekstem", /setTimeout\s*\(\s*["'`]/],
  ];
  for (const [name, re] of sinks) {
    it(`src nie używa: ${name}`, () => {
      const hits = [];
      for (const f of SRC) {
        const t = read(f);
        const m = re.exec(t);
        if (m) hits.push(`${f}:${lineOf(t, m.index)}`);
      }
      expect(hits).toEqual([]);
    });
  }

  it("linki otwierane w nowej karcie mają rel=noopener lub noreferrer", () => {
    const hits = [];
    for (const f of SRC.filter((x) => x.endsWith(".jsx"))) {
      const t = read(f);
      for (const m of t.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
        if (!/rel="[^"]*(noopener|noreferrer)[^"]*"/.test(m[0])) hits.push(`${f}:${lineOf(t, m.index)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("adres strony turnieju z bazy jest sprawdzany (tylko http/https), zanim trafi do linku", () => {
    const t = read("src/pages/TournamentsPage.jsx");
    expect(t).toMatch(/startsWith\(["']http|new URL\(|\^https\?/);
  });

  it("zewnętrzne adresy w kodzie klienta są na liście dozwolonych domen", () => {
    const allowed = [
      "akademiatenisowazabrze.github.io", "akademiatenisowazabrze.pl", "www.akademiatenisowazabrze.pl", "www.pzt.pl", "portal.pzt.pl",
      "nominatim.openstreetmap.org", "tile.openstreetmap.org", "www.openstreetmap.org", "openstreetmap.org", "www.google.com", "maps.google.com",
      "supabase.co", "firebase", "googleapis.com", "gstatic.com", "w3.org", "github.com", "unpkg.com", "leafletjs.com", "localhost",
      "calendar.google.com", "schema.org", "firebaseapp.com", "firebaseio.com", "google.com",
    ];
    const bad = [];
    for (const f of SRC) {
      const t = read(f);
      for (const m of t.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const host = m[1].toLowerCase();
        if (!allowed.some((a) => host === a || host.endsWith("." + a) || host.includes(a))) bad.push(`${f}: ${host}`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("wyszukiwanie adresów (Nominatim) działa tylko na żądanie, nie w trakcie pisania", () => {
    const t = read("src/components/MeetingPoint.jsx");
    expect(t).toMatch(/nominatim\.openstreetmap\.org/);
    // zapytanie jest w funkcji wywoływanej przyciskiem, a nie w efekcie reagującym na wpisywany tekst
    expect(t).not.toMatch(/useEffect\([^)]*\bquery\b[\s\S]{0,120}fetch\(/);
  });

  it("aplikacja nie odwołuje się do martwego serwera Railway", () => {
    for (const f of SRC) expect(read(f), f).not.toMatch(/railway\.app/i);
  });
});

describe("strony pomocnicze (docs): wstrzykiwanie HTML", () => {
  // Wartości z bazy trafiają do innerHTML w panelu admina; muszą przechodzić przez esc().
  it("panel admina ma funkcję esc() zamieniającą znaki specjalne", () => {
    const t = read("docs/admin.html");
    expect(t).toMatch(/function esc\(/);
    expect(t).toMatch(/&amp;/);
    expect(t).toMatch(/&lt;/);
  });

  it("wynik esc() nigdy nie trafia do wartości atrybutu HTML (esc nie zamienia cudzysłowów)", () => {
    const t = read("docs/admin.html");
    const inAttr = [...t.matchAll(/=\s*"[^"\n]*\$\{\s*esc\(/g)].map((m) => lineOf(t, m.index));
    expect(inAttr).toEqual([]);
  });

  it("esc() zamienia także cudzysłowy, więc jest bezpieczne w każdym kontekście HTML", () => {
    const t = read("docs/admin.html");
    const m = /function esc\(s\)\s*{([\s\S]*?)\n  }/.exec(t);
    expect(m, "nie znaleziono esc()").not.toBeNull();
    expect(m[1]).toMatch(/&quot;/);
  });

  it("pola wpisywane przez użytkowników (opisy, nazwy, powody) trafiają do szablonów HTML tylko przez esc()", () => {
    const t = read("docs/admin.html");
    const USER_FIELDS = ["tester_name", "screen", "report_type", "description", "steps", "reason", "full_name", "club_name", "phone", "place_name", "notes", "apk_version", "comment"];
    const unescaped = [];
    for (const m of t.matchAll(/\$\{([^}]+)\}/g)) {
      const expr = m[1].trim();
      if (/^esc\(/.test(expr)) continue;
      for (const f of USER_FIELDS) {
        if (new RegExp(`\\.${f}\\b`).test(expr)) unescaped.push(`${lineOf(t, m.index)}: ${expr.slice(0, 60)}`);
      }
    }
    expect(unescaped).toEqual([]);
  });

  for (const f of DOCS_HTML) {
    it(`${f}: linki zewnętrzne w nowej karcie mają rel=noopener lub noreferrer`, () => {
      const t = read(f);
      const bad = [...t.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].filter((m) => !/rel="[^"]*(noopener|noreferrer)/.test(m[0]));
      expect(bad.map((m) => m[0].slice(0, 80))).toEqual([]);
    });
  }

  it("żadna strona pomocnicza nie ładuje skryptów z nieznanych domen", () => {
    const allowedHosts = ["cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];
    const bad = [];
    for (const f of DOCS_HTML) {
      const t = read(f);
      for (const m of t.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/g)) {
        const host = new URL(m[1]).hostname;
        if (!allowedHosts.includes(host)) bad.push(`${f}: ${host}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("formularz błędów testerów zapisuje tylko do Supabase przez klucz publiczny", () => {
    const t = read("docs/testerzy.html");
    expect(t).toMatch(/TT_CONFIG|supabase/i);
    expect(t).not.toMatch(/sb_secret_|service_role/);
  });
});

describe("kontrakty aplikacji (regresje z wcześniejszych poprawek)", () => {
  it("nagłówek aplikacji ma logotypy ATZ i PZT jako linki do ich stron", () => {
    const t = read("src/App.jsx");
    expect(t).toMatch(/href="https:\/\/www\.akademiatenisowazabrze\.pl\/"/);
    expect(t).toMatch(/href="https:\/\/www\.pzt\.pl\/"/);
    expect(t).toMatch(/atz-logo\.png/);
    expect(t).toMatch(/pzt-logo\.png/);
  });

  it("ekran logowania ma logotypy ATZ i PZT jako linki", () => {
    const t = read("src/pages/AuthPage.jsx");
    expect(t).toMatch(/href="https:\/\/www\.akademiatenisowazabrze\.pl\/"/);
    expect(t).toMatch(/href="https:\/\/www\.pzt\.pl\/"/);
  });

  it("stopki dokumentacji i strony testerów mają linki do ATZ i PZT", () => {
    for (const f of ["docs/dokumentacja.html", "docs/testerzy.html"]) {
      const t = read(f);
      expect(t, f).toMatch(/akademiatenisowazabrze\.pl/);
      expect(t, f).toMatch(/pzt\.pl/);
    }
  });

  it("zrezygnowano z wyszukiwania turnieju po zawodniku (nie wraca do aplikacji)", () => {
    const t = read("src/pages/TournamentsPage.jsx");
    expect(t).not.toMatch(/PlayerTournamentFinder/);
    expect(t).not.toMatch(/Znajdź turniej po zawodniku/i);
  });

  it("weryfikacja loginu PZT idzie przez Edge Function, nie przez stary backend", () => {
    const t = read("src/lib/usePztPlayerSearch.js");
    expect(t).toMatch(/functions\.invoke\(\s*["']pzt-player-lookup["']/);
  });

  it("nie ma już danych próbnych (mockData) w aplikacji", () => {
    expect(exists("src/mockData.js")).toBe(false);
    for (const f of SRC) expect(read(f), f).not.toMatch(/from\s+["'][./]*mockData/);
  });

  it("Service Worker rejestrowany jest tylko poza aplikacją natywną i z automatycznym przeładowaniem", () => {
    const t = read("src/main.jsx");
    expect(t).toMatch(/isNativePlatform/);
    expect(t).toMatch(/controllerchange/);
    expect(t).toMatch(/visibilitychange/);
    const v = read("vite.config.js");
    expect(v).toMatch(/injectRegister:\s*null/);
    expect(v).toMatch(/registerType:\s*"autoUpdate"/);
  });

  it("SPA ma obejście dla głębokich linków na GitHub Pages (404.html)", () => {
    expect(read("docs/404.html")).toMatch(/\/app\//);
    expect(read("src/main.jsx")).toMatch(/restoreSpaPath/);
  });

  it("dostępny jest przełącznik motywu, a domyślnie ciemny", () => {
    const t = read("src/App.jsx");
    expect(t).toMatch(/tennis-together-theme/);
    expect(t).toMatch(/\|\| "dark"/);
  });

  it("pasek nawigacji uwzględnia bezpieczne obszary Androida", () => {
    expect(read("src/App.jsx")).toMatch(/safe-area-inset-bottom/);
  });

  it("zakładka Klub jest dodawana wyłącznie dla roli coach", () => {
    const t = read("src/App.jsx");
    expect(t).toMatch(/account\?\.role === "coach"/);
  });

  it("limit rejestracji na godzinę jest ustawiony", () => {
    expect(read("src/pages/AuthPage.jsx")).toMatch(/SIGNUP_LIMIT_PER_HOUR\s*=\s*\d+/);
  });

  it("wylogowanie usuwa token powiadomień tego urządzenia", () => {
    const t = read("src/lib/AuthContext.jsx");
    expect(t).toMatch(/from\("device_tokens"\)\.delete\(\)/);
  });

  it("kalendarz i mapa są ładowane leniwie (nie obciążają startu)", () => {
    const t = read("src/components/MeetingPoint.jsx");
    expect(t).toMatch(/lazy\(|import\(/);
  });
});
