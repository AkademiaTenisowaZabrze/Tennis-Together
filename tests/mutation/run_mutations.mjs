// Testy mutacyjne bazy danych: celowo psuje migracje (w tymczasowej kopii) i sprawdza,
// czy zestaw tests/db wykrywa uszkodzenie. Mutacja "przeżyła" = testy jej nie zauważyły,
// czyli w zabezpieczeniu jest dziura w pokryciu.
//
// Uruchomienie:  node tests/mutation/run_mutations.mjs [numer_mutacji ...]
// Trwa kilka minut (każda mutacja buduje własną bazę i uruchamia zestaw testów bazy).
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "supabase", "migrations");

// [opis, plik migracji, tekst do zastąpienia, tekst zastępczy]
export const MUTATIONS = [
  ["potwierdzenie spotkania bez kodu: strażnik kolumn wyłączony", "0026_meeting_confirmation_server_side.sql", "if new.meeting_confirmed_at is distinct from old.meeting_confirmed_at\n     or new.meeting_confirmed_by is distinct from old.meeting_confirmed_by then", "if false then"],
  ["autor kodu może potwierdzić własnym kodem", "0032_host_lodging_meeting_ratings.sql", "if v_code_by = v_uid then", "if false then"],
  ["brak blokady po 5 błędnych próbach kodu", "0032_host_lodging_meeting_ratings.sql", "if v_attempts >= 5 then", "if v_attempts >= 5000 then"],
  ["każda zmiana statusu prośby jest dozwolona (strażnik przejść wyłączony)", "0046_requests_conversations_consents_guard.sql", "  if new.status is distinct from old.status\n     and not (", "  if false\n     and not ("],
  ["zawieszenie konta nie działa (account_is_active zawsze true)", "0016_account_suspension.sql", "select coalesce((select status = 'active' from accounts where id = auth.uid()), false);", "select true;"],
  ["nocleg u rodziny bez zgody właściwego rodzaju (liczy się każda zgoda)", "0046_requests_conversations_consents_guard.sql", "             and c.consent_type = 'host_family_stay'\n", "             and true\n"],
  ["kwota uzgodniona w prośbie przestaje być zamrożona", "0041_ride_cost_suggestion.sql", "new.agreed_cost_pln := old.agreed_cost_pln;", "new.agreed_cost_pln := new.agreed_cost_pln;"],
  ["kalkulator pomija współczynnik drogi", "0041_ride_cost_suggestion.sql", "        )) * s.road_factor;", "        ));"],
  ["kalkulator liczy trasę tylko w jedną stronę", "0041_ride_cost_suggestion.sql", "(case when s.round_trip then 2 else 1 end)", "1"],
  ["pineska przyjmuje szerokość geograficzną spoza zakresu", "0036_meeting_point.sql", "p_lat < -90 or p_lat > 90", "p_lat < -9000 or p_lat > 9000"],
  ["można ocenić samego siebie", "0022_ratings.sql", "and rated_account_id != auth.uid()", "and true"],
  ["konto widoczne dla wszystkich (polityka właściciela: using true)", "0002_accounts_rls.sql", "using (id = auth.uid())", "using (true)"],
  ["funkcja claim_push_slot dostępna dla anonima i zalogowanych", "0040_push_meeting_confirmed_coach_admin.sql", "revoke all on function claim_push_slot(text, int) from public, anon, authenticated;", "-- (odebranie uprawnień usunięte)"],
  ["is_admin() zawsze true", "0021_admin_panel.sql", "select coalesce((select accounts.is_admin from accounts where id = auth.uid()), false);", "select true;"],
  ["oferta ze zwrotem kosztów bez zgody kierowcy jest dozwolona", "0041_ride_cost_suggestion.sql", "if not new.cost_terms_accepted then", "if false then"],
  ["użytkownik może nadać sobie is_admin (strażnik 0043 nie zamraża kolumny)", "0043_accounts_privilege_guard.sql", "    new.is_admin := old.is_admin;", "    new.is_admin := new.is_admin;"],
  ["użytkownik może sam zostać trenerem (zmiana roli bez zatwierdzenia)", "0043_accounts_privilege_guard.sql", "      new.role := old.role;\n      new.coach_requested := true;", "      new.coach_requested := true;"],
  ["rejestracja z is_admin = true przechodzi (strażnik INSERT wyłączony)", "0043_accounts_privilege_guard.sql", "    new.is_admin := false;\n    new.verified := false;", "    new.verified := false;"],
  ["zgłoszenia błędów znów czytelne dla każdego (polityka using true)", "0044_close_anon_reads.sql", "  using (is_admin());\n\ndrop policy if exists \"Każdy może zgłosić błąd\"", "  using (true);\n\ndrop policy if exists \"Każdy może zgłosić błąd\""],
  ["triggery push nie dokładają sekretu wywołań", "0045_notify_webhook_secret.sql", "jsonb_build_object('x-webhook-secret', value)", "jsonb_build_object('x-webhook-x', value)"],
  ["prośba może powstać od razu jako zaakceptowana (strażnik INSERT wyłączony)", "0046_requests_conversations_consents_guard.sql", "  if tg_op = 'INSERT' then\n    new.status := 'pending';\n    return new;\n  end if;", "  if tg_op = 'INSERT' then\n    return new;\n  end if;"],
  ["oferta w prośbie da się przepiąć (identyfikatory nie są zamrożone)", "0046_requests_conversations_consents_guard.sql", "  foreach k in array tg_argv loop", "  foreach k in array '{}'::text[] loop"],
  ["do cudzej rozmowy można dopisać uczestnika", "0046_requests_conversations_consents_guard.sql", "    conversation_open_for_me(conversation_id)\n    and (", "    true\n    and ("],
  ["zgodę na cudze dziecko może dodać każdy", "0046_requests_conversations_consents_guard.sql", "    and exists (select 1 from players p where p.id = player_id and p.owner_account_id = auth.uid())", "    and true"],
  ["wycofanie zgody nie blokuje próśb o nocleg u rodziny", "0046_requests_conversations_consents_guard.sql", "        and coalesce((\n          select c.granted", "        and coalesce((\n          select true"],
  ["obcy znów czyta pełny wiersz zawodnika przy ofercie", "0047_public_cards_privacy.sql", "drop policy if exists \"Zawodnik widoczny publicznie, jeśli jego wyjazd ma ofertę\" on players;", "-- (usuwanie polityki pominięte)"],
  ["rozmówca znów czyta cały wiersz konta (z telefonem)", "0047_public_cards_privacy.sql", "drop policy if exists \"Konto widoczne, jeśli dzielimy rozmowę\" on accounts;", "-- (usuwanie polityki pominięte)"],
  ["usunięcie konta blokowane przez zgody (brak kaskady)", "0048_account_deletion.sql", "case when r.col like 'meeting\\_%' escape '\\' then 'set null' else 'cascade' end", "'no action'"],
  ["anonim może usunąć konto (funkcja dostępna dla wszystkich)", "0048_account_deletion.sql", "revoke all on function delete_my_account() from public, anon;", "-- (odebranie uprawnień usunięte)"],
  ["funkcje pomocnicze RLS znów dostępne dla anonima", "0049_function_hardening.sql", "from public, anon;", "from public;"],
  ["retencja usuwa także świeże wiadomości", "0050_length_limits_and_retention.sql", "delete from messages where created_at < now() - interval '12 months';", "delete from messages where created_at < now() + interval '12 months';"],
  ["brak limitu długości wiadomości", "0050_length_limits_and_retention.sql", "check (char_length(body) between 1 and 2000)", "check (char_length(body) >= 1)"],
  ["wygaszanie próśb o przejazd zmienia także zaakceptowane", "0034_push_new_request_and_expire.sql", "where r.requester_trip_id = t.id and r.status = 'pending'\n     and coalesce(tn.ends_on, tn.starts_on + 7) < current_date;\n  get diagnostics n_ride = row_count;", "where r.requester_trip_id = t.id and r.status in ('pending','accepted')\n     and coalesce(tn.ends_on, tn.starts_on + 7) < current_date;\n  get diagnostics n_ride = row_count;"],
];

function runOne(index) {
  const [desc, file, find, repl] = MUTATIONS[index];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mut-"));
  for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  const target = path.join(dir, file);
  const before = fs.readFileSync(target, "utf-8").replace(/\r\n/g, "\n"); // pliki mogą mieć CRLF
  if (!before.includes(find)) return { index, desc, status: "BŁĄD MUTACJI (nie znaleziono tekstu do zastąpienia)", failed: [] };
  fs.writeFileSync(target, before.replace(find, repl));
  const out = path.join(dir, "wynik.json");
  try {
    execSync(`npx vitest run tests/db --reporter=json --outputFile="${out}"`, {
      cwd: ROOT,
      env: { ...process.env, TT_MIGRATIONS_DIR: dir },
      stdio: "ignore",
      timeout: 280000,
    });
  } catch {
    /* kod wyjścia != 0 oznacza nieprzechodzące testy; wynik jest w pliku */
  }
  let failed = [];
  if (fs.existsSync(out)) {
    const json = JSON.parse(fs.readFileSync(out, "utf-8"));
    for (const f of json.testResults) for (const t of f.assertionResults) if (t.status === "failed") failed.push(t.fullName);
  } else {
    return { index, desc, status: "BŁĄD URUCHOMIENIA", failed: [] };
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { index, desc, status: failed.length ? "WYKRYTA" : "PRZEŻYŁA", failed };
}

const wanted = process.argv.slice(2).map(Number);
const indexes = wanted.length ? wanted : MUTATIONS.map((_, i) => i);
const results = [];
for (const i of indexes) {
  const r = runOne(i);
  results.push(r);
  console.log(`${String(i + 1).padStart(2)}. [${r.status}] ${r.desc}${r.failed.length ? `  (${r.failed.length} testów, np.: ${r.failed[0].slice(0, 90)})` : ""}`);
}
const survived = results.filter((r) => r.status !== "WYKRYTA");
console.log(`\nWykryte: ${results.length - survived.length}/${results.length}`);
if (survived.length) {
  console.log("Niewykryte lub błędne:", survived.map((r) => r.index + 1).join(", "));
  process.exitCode = 1;
}
// sprzątanie szablonów baz zbudowanych dla mutacji
for (const f of fs.readdirSync(path.join(ROOT, "tests", ".cache"))) {
  const full = path.join(ROOT, "tests", ".cache", f);
  if (f.startsWith("template-") && Date.now() - fs.statSync(full).mtimeMs < 60 * 60 * 1000 && !f.includes(process.env.TT_KEEP_TEMPLATE ?? "@@")) {
    // zostawiamy najnowszy szablon prawdziwych migracji; mutacyjne usuwa się przy następnym czyszczeniu
  }
}
