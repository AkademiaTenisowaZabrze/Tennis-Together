// CI (GitHub Actions), kontrakt Edge Functions, RODO i higiena migracji.
import { describe, it, expect } from "vitest";
import { read, exists, filesUnder, lineOf } from "../helpers/repo.mjs";

const WORKFLOWS = filesUnder(".github/workflows", /\.ya?ml$/);
const MIGRATIONS = filesUnder("supabase/migrations", /\.sql$/).sort();

describe("GitHub Actions", () => {
  it("jest co najmniej 8 workflow", () => {
    expect(WORKFLOWS.length).toBeGreaterThanOrEqual(8);
  });

  it("żaden workflow nie używa pull_request_target (uruchamianie kodu z cudzych forków z sekretami)", () => {
    for (const f of WORKFLOWS) expect(read(f), f).not.toMatch(/pull_request_target/);
  });

  it("sekrety nie są wypisywane do logów", () => {
    for (const f of WORKFLOWS) {
      const t = read(f);
      // echo sekretu jest dopuszczalny tylko wtedy, gdy trafia do pliku lub potoku (np. odkodowanie keystore)
      for (const line of t.split("\n").filter((l) => /echo\s+["']?\$\{\{\s*secrets\./.test(l))) {
        expect(line, `${f}: ${line.trim()}`).toMatch(/\|\s*base64|>\s*\S+/);
      }
      expect(t, f).not.toMatch(/set -x[\s\S]{0,200}secrets\./);
    }
  });

  it("klucz service_role jest używany wyłącznie przez workflow importujące dane i retencję", () => {
    const allowed = new Set([
      ".github/workflows/import-tennis-europe.yml",
      ".github/workflows/import-tournament-entries.yml",
      ".github/workflows/import-tournaments.yml",
      ".github/workflows/update-fuel-price.yml",
      ".github/workflows/retention.yml",
    ]);
    const users = WORKFLOWS.filter((f) => /SERVICE_ROLE/.test(read(f)));
    for (const f of users) expect(allowed.has(f), `${f} używa service_role`).toBe(true);
    expect(users.length).toBeGreaterThanOrEqual(3);
  });

  it("klucz service_role pochodzi z sekretu GitHub, nie z pliku", () => {
    for (const f of WORKFLOWS.filter((x) => /SERVICE_ROLE/.test(read(x)))) {
      expect(read(f), f).toMatch(/SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY\s*\}\}/);
    }
  });

  it("workflow przypomnień używa tylko publicznego klucza i jednej funkcji", () => {
    const t = read(".github/workflows/trip-reminders.yml");
    expect(t).toMatch(/sb_publishable_/);
    expect(t).not.toMatch(/service_role|SERVICE_ROLE/i);
    const urls = [...t.matchAll(/functions\/v1\/([a-z-]+)/g)].map((m) => m[1]);
    expect(new Set(urls)).toEqual(new Set(["notify-tournament"]));
  });

  it("harmonogramy cron mają poprawny format (5 pól) i nie częściej niż co godzinę", () => {
    for (const f of WORKFLOWS) {
      for (const m of read(f).matchAll(/cron:\s*"([^"]+)"/g)) {
        const parts = m[1].trim().split(/\s+/);
        expect(parts.length, `${f}: ${m[1]}`).toBe(5);
        expect(/^\*(\/\d+)?$/.test(parts[0]) && parts[0] !== "0", `${f}: zbyt częsty cron ${m[1]}`).toBe(false);
      }
    }
  });

  it("oficjalne akcje GitHub są przypięte do wersji głównej (tag)", () => {
    for (const f of WORKFLOWS) {
      for (const m of read(f).matchAll(/uses:\s*(actions\/[a-z-]+)@(\S+)/g)) {
        expect(m[2], `${f}: ${m[1]}`).toMatch(/^v\d+/);
      }
    }
  });

  it("akcje firm trzecich są przypięte do pełnego skrótu commita (ochrona łańcucha dostaw)", () => {
    const bad = [];
    for (const f of WORKFLOWS) {
      for (const m of read(f).matchAll(/uses:\s*([^@\s]+)@(\S+)/g)) {
        if (!m[1].startsWith("actions/") && !/^[0-9a-f]{40}$/.test(m[2])) bad.push(`${f}: ${m[1]}@${m[2]}`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("workflow z kluczem service_role deklarują minimalne uprawnienia (permissions: contents: read)", () => {
    const bad = WORKFLOWS.filter((f) => /SERVICE_ROLE/.test(read(f)) && !/^permissions:/m.test(read(f)));
    expect(bad).toEqual([]);
  });

  it("workflow budujące APK i stronę mają jawnie zadeklarowane uprawnienia", () => {
    for (const f of ["android-build.yml", "android-debug-apk.yml", "deploy-web.yml"]) {
      expect(read(`.github/workflows/${f}`), f).toMatch(/permissions:/);
    }
  });

  it("budowanie strony używa wersji bazowej /Tennis-Together/app/", () => {
    expect(read(".github/workflows/deploy-web.yml")).toMatch(/VITE_BASE/);
  });
});

describe("kontrakt Edge Functions", () => {
  const fn = read("supabase/functions/notify-tournament/index.ts");
  const handled = new Set([...fn.matchAll(/event === "([a-z_]+)"/g)].map((m) => m[1]));
  const sqlEvents = new Set();
  for (const f of MIGRATIONS) for (const m of read(f).matchAll(/'event',\s*'([a-z_]+)'/g)) sqlEvents.add(m[1]);

  it("funkcja obsługuje co najmniej 10 rodzajów zdarzeń", () => {
    expect(handled.size).toBeGreaterThanOrEqual(10);
  });

  it("każde zdarzenie wysyłane przez trigger w bazie jest obsługiwane przez funkcję", () => {
    const missing = [...sqlEvents].filter((e) => !handled.has(e));
    expect(missing).toEqual([]);
  });

  it("zdarzenia bez triggera pochodzą z harmonogramu GitHub lub skryptu importu", () => {
    const external = [...handled].filter((e) => !sqlEvents.has(e)).sort();
    expect(external).toEqual(["selection_published", "trip_reminders"]);
    expect(read("scripts/import_tournament_entries.py")).toMatch(/selection_published/);
    expect(read(".github/workflows/trip-reminders.yml")).toMatch(/trip_reminders/);
  });

  it("funkcja waliduje typy danych wejściowych (zła treść daje 400, nie 500)", () => {
    expect(fn).toMatch(/status:\s*400/);
    expect(fn).toMatch(/typeof \w+ !== "string"|typeof \w+ !== "number"/);
  });

  it("jednorazowość powiadomień jest pilnowana w bazie (kolumny biletów i claim_*)", () => {
    for (const col of ["push_sent_at", "created_push_sent_at", "closed_push_sent_at", "confirmed_push_sent_at", "meeting_point_push_at", "selection_push_at"]) {
      expect(fn, col).toContain(col);
    }
    expect(fn).toMatch(/claim_push_slot/);
    expect(fn).toMatch(/claim_trip_reminders/);
  });

  it("treść powiadomień nie zawiera nazwisk (tylko nazwa turnieju lub ogólny komunikat)", () => {
    const texts = [...fn.matchAll(/title:\s*\(?[^,]*=>\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
    for (const t of texts) expect(t).not.toMatch(/last_name|full_name|\.name\b/);
  });

  it("odpowiedzi błędów nie ujawniają śladu stosu", () => {
    for (const f of ["notify-tournament", "pzt-player-lookup"]) {
      expect(read(`supabase/functions/${f}/index.ts`), f).not.toMatch(/\.stack\b/);
    }
  });

  it("notify-tournament weryfikuje wywołującego (sekret nagłówka lub JWT), a nie tylko klucz publiczny", () => {
    expect(fn).toMatch(/x-webhook-secret|WEBHOOK_SECRET|CRON_SECRET|getUser\(|auth\.getUser/);
  });

  it("pzt-player-lookup wymaga zalogowanego użytkownika", () => {
    expect(read("supabase/functions/pzt-player-lookup/index.ts")).toMatch(/getUser\(|auth\.getUser|verify_jwt|auth\/v1\/user/);
  });

  it("pzt-player-lookup sprawdza format loginu PZT (3 litery i 7 cyfr), zanim zapyta portal", () => {
    expect(read("supabase/functions/pzt-player-lookup/index.ts")).toMatch(/\[A-Z\]\{3\}|\\d\{7\}|\^\[A-Z0-9\]/);
  });

  it("pzt-player-lookup odpytuje wyłącznie portal PZT", () => {
    const t = read("supabase/functions/pzt-player-lookup/index.ts");
    const hosts = [...t.matchAll(/https?:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]);
    expect(new Set(hosts.filter((h) => !h.includes("w3.org")))).toEqual(new Set(["portal.pzt.pl"]));
  });

  it("login PZT jest kodowany w adresie (brak wstrzyknięcia ścieżki)", () => {
    expect(read("supabase/functions/pzt-player-lookup/index.ts")).toMatch(/encodeURIComponent\(login\)/);
  });
});

describe("RODO i zgody", () => {
  const docs = filesUnder("docs", /\.html$/).map((f) => f.toLowerCase());

  it("istnieje osobna polityka prywatności (dokument dla użytkowników)", () => {
    expect(docs.some((f) => /prywatno|privacy|polityka/.test(f))).toBe(true);
  });

  it("istnieje regulamin korzystania z aplikacji (dokument)", () => {
    expect(docs.some((f) => /regulamin|terms/.test(f))).toBe(true);
  });

  it("w profilu jest funkcja usunięcia konta i danych", () => {
    expect(read("src/pages/ProfilePage.jsx")).toMatch(/Usuń (moje )?konto|delete account/i);
  });

  it("istnieje mechanizm retencji danych (czyszczenie starych wiadomości, pineski, zgłoszeń)", () => {
    const all = MIGRATIONS.map(read).join("\n") + WORKFLOWS.map(read).join("\n");
    expect(all).toMatch(/delete from (messages|ride_pings|bug_reports)|pg_cron|retention/i);
  });

  it("zgoda na regulamin i przetwarzanie danych jest zapisywana przy rejestracji", () => {
    const t = read("src/pages/AuthPage.jsx") + read("src/lib/AuthContext.jsx");
    expect(t).toMatch(/terms_accepted_at/);
  });

  it("rejestracja mówi, że konto zakłada tylko dorosły opiekun lub trener", () => {
    expect(read("src/pages/AuthPage.jsx")).toMatch(/zakłada tylko dorosły/);
  });

  it("zgoda na nocleg u rodziny jest wymagana przed wysłaniem prośby (UI i baza)", () => {
    expect(read("src/pages/LodgingPage.jsx")).toMatch(/host_family_stay|zgod/i);
    expect(read("supabase/migrations/0031_host_family_lodging.sql")).toMatch(/consent_type = 'host_family_stay'/);
  });

  it("numer telefonu i adres e-mail nie są wyświetlane drugiej stronie w karcie rozmówcy", () => {
    const t = read("src/components/CounterpartCard.jsx");
    expect(t).not.toMatch(/phone|telefon|email|e-mail/i);
  });

  it("zdjęcie profilowe jest opcjonalne i opisane jako niebędące weryfikacją", () => {
    expect(read("src/pages/ProfilePage.jsx")).toMatch(/opcjonalne/i);
  });

  it("dokumentacja opisuje model zaufania i dane przetwarzane w aplikacji", () => {
    const t = read("docs/dokumentacja.html");
    expect(t).toMatch(/Zaufanie między nieznajomymi/);
    expect(t).toMatch(/Dzielenie kosztów przejazdu/);
  });
});

describe("higiena migracji", () => {
  it("numeracja migracji jest ciągła, bez luk i duplikatów", () => {
    const nums = MIGRATIONS.map((f) => Number(/(\d{4})_/.exec(f)[1]));
    expect(nums[0]).toBe(1);
    nums.forEach((n, i) => expect(n, `luka lub duplikat przy ${MIGRATIONS[i]}`).toBe(i + 1));
  });

  it("każda tabela ma włączony RLS w migracjach", () => {
    const all = MIGRATIONS.map(read).join("\n");
    const tables = [...all.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_]+)/gi)].map((m) => m[1]);
    const enabled = new Set([...all.matchAll(/alter table (?:public\.)?([a-z_]+) enable row level security/gi)].map((m) => m[1]));
    expect(tables.filter((t) => !enabled.has(t))).toEqual([]);
  });

  it("żadna migracja nie wyłącza RLS ani nie nadaje uprawnień anonimowi lub publicznie", () => {
    for (const f of MIGRATIONS) {
      const t = read(f).replace(/--.*$/gm, "");
      expect(t, f).not.toMatch(/disable row level security/i);
      expect(t, f).not.toMatch(/grant\s+(all|insert|update|delete)[^;]*\sto\s+(anon|public)/i);
    }
  });

  it("nowe funkcje SECURITY DEFINER (poza triggerami) odbierają dostęp anonimowi albo są na liście jawnie publicznych", () => {
    const publicByDesign = new Set([
      "account_is_active", "account_rating", "admin_stats", "can_rate", "is_admin", "is_conversation_participant",
      "match_profile", "player_visible_to_my_coach", "trip_has_public_offer", "trip_is_requester_for_my_offer",
    ]);
    const all = MIGRATIONS.map(read).join("\n").replace(/--.*$/gm, "");
    const bad = [];
    for (const m of all.matchAll(/create (?:or replace )?function\s+(?:public\.)?([a-z_]+)\s*\([^)]*\)\s*returns\s+([a-z_ ]+?)\s*(?:language|as|security|stable|set)/gi)) {
      const [, name, ret] = m;
      if (/^trigger$/i.test(ret.trim())) continue;
      const defIdx = m.index;
      const head = all.slice(defIdx, defIdx + 400);
      if (!/security\s+definer/i.test(head)) continue;
      const revoked = new RegExp(`revoke\\s+(all|execute)[^;]*function\\s+${name}\\b[^;]*from[^;]*(anon|public)`, "i").test(all);
      if (!revoked && !publicByDesign.has(name)) bad.push(name);
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("adres Supabase w triggerach powiadomień jest wszędzie ten sam i zgodny ze skryptem instalacyjnym", () => {
    const urls = new Set();
    for (const f of MIGRATIONS) for (const m of read(f).matchAll(/https:\/\/([a-z0-9]+)\.supabase\.co/g)) urls.add(m[1]);
    expect([...urls]).toEqual(["jrabxtiranllayerhutm"]);
    expect(read("scripts/build_setup_sql.py")).toContain("jrabxtiranllayerhutm");
    expect(read("docs/config.js")).toContain("jrabxtiranllayerhutm");
  });

  it("w migracjach wywołujących funkcję jest tylko klucz publiczny (publishable)", () => {
    for (const f of MIGRATIONS) {
      const t = read(f);
      const keys = [...t.matchAll(/Bearer\s+(sb_[a-z]+_[A-Za-z0-9_-]+)/g)].map((m) => m[1]);
      for (const k of keys) expect(k, f).toMatch(/^sb_publishable_/);
    }
  });

  it("migracje są w UTF-8 bez BOM", () => {
    for (const f of MIGRATIONS) {
      const buf = Buffer.from(read(f), "utf-8");
      expect(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, f).toBe(false);
    }
  });

  it("migracje nie usuwają tabel z danymi użytkowników", () => {
    for (const f of MIGRATIONS) {
      const t = read(f).replace(/--.*$/gm, "");
      expect(t, f).not.toMatch(/drop table(?! if exists (push_throttle|_tmp))/i);
      expect(t, f).not.toMatch(/\btruncate\b/i);
    }
  });

  it("funkcje wywoływane z klienta (rpc) istnieją w migracjach", () => {
    const all = MIGRATIONS.map(read).join("\n");
    const used = new Set();
    for (const f of filesUnder("src", /\.(js|jsx)$/)) for (const m of read(f).matchAll(/rpc\(\s*["']([a-z_]+)["']/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThanOrEqual(6);
    for (const name of used) expect(all, name).toMatch(new RegExp(`function\\s+${name}\\b`));
  });

  it("tabele używane przez klienta (from) istnieją w migracjach", () => {
    const all = MIGRATIONS.map(read).join("\n");
    const used = new Set();
    for (const f of filesUnder("src", /\.(js|jsx)$/)) for (const m of read(f).matchAll(/\.from\(\s*["']([a-z_]+)["']/g)) used.add(m[1]);
    for (const name of used) {
      if (name === "avatars") continue; // kontener Storage, nie tabela
      expect(all, name).toMatch(new RegExp(`create table (if not exists )?(public\\.)?${name}\\b`));
    }
  });
});
