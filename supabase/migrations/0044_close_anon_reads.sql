-- Zamknięcie otwartego odczytu dla anonima (audyt bezpieczeństwa 2026-10-03, luka F4) oraz limity
-- długości w formularzu zgłoszeń błędów (F23, część dotycząca bug_reports).
--
-- * bug_reports: do tej pory SELECT dla `anon` i `authenticated` (using true), więc każdy z kluczem
--   publicznym mógł pobrać wszystkie zgłoszenia (imiona testerów, opisy, kroki). Teraz czyta je tylko
--   administrator (panel admina). Zgłaszanie błędu zostaje otwarte (formularz na stronie testerów
--   działa bez logowania), ale z limitami długości pól.
-- * signup_attempts: licznik prób rejestracji był czytany wprost z tabeli. Zastępuje go funkcja
--   signup_attempts_last_hour() zwracająca samą liczbę; tabela nie jest już czytelna dla anonima.

-- ── bug_reports ───────────────────────────────────────────────────────────

drop policy if exists "Każdy może zobaczyć zgłoszenia" on bug_reports;

create policy "Admin czyta zgłoszenia błędów"
  on bug_reports for select
  to authenticated
  using (is_admin());

drop policy if exists "Każdy może zgłosić błąd" on bug_reports;

create policy "Każdy może zgłosić błąd"
  on bug_reports for insert
  to anon, authenticated
  with check (
    char_length(description) between 1 and 4000
    and coalesce(char_length(steps), 0) <= 4000
    and coalesce(char_length(tester_name), 0) <= 120
    and coalesce(char_length(screen), 0) <= 120
    and coalesce(char_length(report_type), 0) <= 60
    and coalesce(char_length(priority), 0) <= 60
    and coalesce(char_length(apk_version), 0) <= 60
  );

-- ── signup_attempts ───────────────────────────────────────────────────────

drop policy if exists "Każdy widzi licznik prób rejestracji" on signup_attempts;

create or replace function signup_attempts_last_hour()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::int from signup_attempts where created_at > now() - interval '1 hour';
$$;

revoke all on function signup_attempts_last_hour() from public;
grant execute on function signup_attempts_last_hour() to anon, authenticated;
