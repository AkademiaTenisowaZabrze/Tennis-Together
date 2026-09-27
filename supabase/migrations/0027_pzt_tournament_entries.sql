-- Oficjalna lista startowa PZT (po selekcji) dla turniejów OTK — Paweł,
-- 2026-09-27: "jak jest turniej i jest ustalona lista kto jedzie, to będzie
-- można zapytać czy ktoś nas nie zabierze na dany turniej".
--
-- Dane pochodzą z API projektu "NOWA APLIKACJA PZT ANDROID"
-- (endpoint /tournaments/{id}/acceptance, ten sam co "Znajdź turniej po
-- zawodniku"), importowane przez scripts/import_tournament_entries.py
-- (GitHub Actions, patrz .github/workflows/import-tournament-entries.yml)
-- DOPIERO gdy /tournaments/{id}/status zwróci acceptance=true — zanim
-- selekcja się ukaże, tabela dla tego turnieju po prostu nie ma wierszy.
--
-- To jest publiczny rejestr PZT (imię, nazwisko, klub, ranking — te same
-- dane widoczne dla każdego na portal.pzt.pl), więc RLS jest tu tak samo
-- otwarte jak na `tournaments` (0003): każdy zalogowany widzi, zapis
-- wyłącznie przez service_role (import), żadnej polityki insert/update.

create table tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  pzt_login text not null,
  full_name text not null,
  gender text check (gender in ('K', 'M')),
  category_code text,
  club text,
  age int,
  ranking int,
  created_at timestamptz not null default now(),
  unique (tournament_id, pzt_login)
);

create index tournament_entries_login_idx on tournament_entries (pzt_login);

alter table tournament_entries enable row level security;

create policy "Zalogowani widzą listę startową turnieju"
  on tournament_entries for select
  to authenticated
  using (true);

-- Dopasowanie oficjalnej listy PZT do NASZYCH użytkowników po loginie
-- (players.pzt_login) — SECURITY DEFINER, bo RLS na `players` ("Właściciel
-- widzi i edytuje swoich zawodników", 0001_init.sql) pokazuje każdemu
-- wyłącznie WŁASNYCH zawodników, więc zwykłe zapytanie klienta nigdy by nie
-- znalazło cudzego dopasowania. Funkcja świadomie zwraca tylko minimum:
-- czyj to wyjazd (do wysłania zapytania o podwiezienie) i imię/klub/
-- kategorię — nic więcej z cudzego konta czy profilu zawodnika.
--
-- Warunki, żeby coś się pokazało (wszystkie muszą być spełnione):
--   * turniej ma już opublikowaną listę PZT (tournament_entries niepuste),
--   * druga strona ma w naszej appce zawodnika z tym samym loginem PZT,
--   * ta sama osoba ma w naszej appce WŁASNY wyjazd na TEN SAM turniej
--     (inaczej nie ma do czego przypiąć zapytania o podwiezienie),
--   * jej konto nie jest zawieszone,
--   * pytający SAM też ma wyjazd na ten turniej (funkcja odmawia inaczej) —
--     to nie jest ogólna wyszukiwarka "kto gdzie jedzie", tylko coś dla osób,
--     które już same się na dany turniej wybierają.
create or replace function find_pzt_tournament_matches(p_tournament_id uuid)
returns table (
  trip_id uuid,
  account_id uuid,
  full_name text,
  club text,
  category_code text
)
language sql
security definer
set search_path = public
stable
as $$
  select t.id, a.id, a.full_name, te.club, te.category_code
  from tournament_entries te
  join players p on p.pzt_login = te.pzt_login
  join trips t on t.player_id = p.id and t.tournament_id = te.tournament_id
  join accounts a on a.id = t.created_by_account_id
  where te.tournament_id = p_tournament_id
    and a.status = 'active'
    and t.created_by_account_id <> auth.uid()
    and exists (
      select 1 from trips mine
      where mine.tournament_id = p_tournament_id
        and mine.created_by_account_id = auth.uid()
    );
$$;

revoke all on function find_pzt_tournament_matches(uuid) from public, anon;
grant execute on function find_pzt_tournament_matches(uuid) to authenticated;
