-- Prywatność danych dzieci i telefonu rozmówcy (audyt bezpieczeństwa 2026-10-03: F6 i F8).
--
-- F8  Polityki "zawodnik widoczny publicznie, jeśli jego wyjazd ma ofertę" i "zawodnik proszącego widoczny
--     dla właściciela oferty" odsłaniały CAŁY wiersz `players`: nazwisko, rocznik, miasto i login PZT cudzego
--     dziecka dostępne dla każdego zalogowanego (a konto może założyć każdy). Aplikacja potrzebuje tam
--     wyłącznie imienia (oraz kategorii i klubu).
-- F6  Polityka "Konto widoczne, jeśli dzielimy rozmowę" odsłaniała cały wiersz `accounts` rozmówcy, w tym
--     numer telefonu. Czat potrzebuje tylko imienia i nazwiska.
--
-- Rozwiązanie: wąskie "karty" (player_cards, account_cards) z samymi danymi, które wolno pokazać drugiej
-- stronie, utrzymywane triggerami z tabel źródłowych. Dostęp obcych do pełnych tabel `players`/`accounts`
-- zostaje zamknięty, a aplikacja czyta karty (osadzenie `players:player_cards(first_name)`). Dodatkowe klucze
-- obce (trips -> player_cards, conversation_participants -> account_cards) pozwalają PostgREST osadzać karty
-- bez widoków. Pełne dane widzą nadal: właściciel, trener klubu (zawodnicy) i administrator (konta).

-- ── player_cards ──────────────────────────────────────────────────────────

create table player_cards (
  player_id uuid primary key references players(id) on delete cascade,
  first_name text not null,
  category text,
  club_name text
);

insert into player_cards (player_id, first_name, category, club_name)
select id, first_name, category, club_name from players;

create or replace function sync_player_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into player_cards (player_id, first_name, category, club_name)
  values (new.id, new.first_name, new.category, new.club_name)
  on conflict (player_id) do update
    set first_name = excluded.first_name, category = excluded.category, club_name = excluded.club_name;
  return null;
end;
$$;

drop trigger if exists sync_player_card on players;
create trigger sync_player_card
  after insert or update of first_name, category, club_name on players
  for each row execute function sync_player_card();

revoke all on function sync_player_card() from public, anon, authenticated;

alter table trips
  add constraint trips_player_card_fkey foreign key (player_id) references player_cards(player_id) on delete cascade;

alter table player_cards enable row level security;

create policy "Właściciel widzi karty swoich zawodników"
  on player_cards for select to authenticated
  using (player_id in (select id from players where owner_account_id = auth.uid()));

create policy "Trener widzi karty zawodników swojego klubu"
  on player_cards for select to authenticated
  using (player_visible_to_my_coach(player_id));

create policy "Karta zawodnika widoczna publicznie, jeśli jego wyjazd ma ofertę"
  on player_cards for select to authenticated
  using (player_id in (select trips.player_id from trips where trip_has_public_offer(trips.id)));

create policy "Karta zawodnika proszącego widoczna dla właściciela oferty"
  on player_cards for select to authenticated
  using (player_id in (select trips.player_id from trips where trip_is_requester_for_my_offer(trips.id)));

create policy "Zawieszone konto nie ma dostępu"
  on player_cards as restrictive for all to authenticated
  using (account_is_active())
  with check (account_is_active());

-- Zamknięcie pełnych wierszy dla obcych (zostają: właściciel i trener).
drop policy if exists "Zawodnik widoczny publicznie, jeśli jego wyjazd ma ofertę" on players;
drop policy if exists "Zawodnik proszącego widoczny dla właściciela oferty" on players;

-- ── account_cards ─────────────────────────────────────────────────────────

create table account_cards (
  account_id uuid primary key references accounts(id) on delete cascade,
  full_name text not null
);

insert into account_cards (account_id, full_name)
select id, full_name from accounts;

create or replace function sync_account_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into account_cards (account_id, full_name)
  values (new.id, new.full_name)
  on conflict (account_id) do update set full_name = excluded.full_name;
  return null;
end;
$$;

drop trigger if exists sync_account_card on accounts;
create trigger sync_account_card
  after insert or update of full_name on accounts
  for each row execute function sync_account_card();

revoke all on function sync_account_card() from public, anon, authenticated;

alter table conversation_participants
  add constraint conversation_participants_account_card_fkey
  foreign key (account_id) references account_cards(account_id) on delete cascade;

alter table account_cards enable row level security;

create policy "Własna karta konta"
  on account_cards for select to authenticated
  using (account_id = auth.uid());

create policy "Admin widzi karty wszystkich kont"
  on account_cards for select to authenticated
  using (is_admin());

create policy "Karta konta widoczna, jeśli dzielimy rozmowę"
  on account_cards for select to authenticated
  using (
    account_id in (
      select cp2.account_id
        from conversation_participants cp1
        join conversation_participants cp2 on cp2.conversation_id = cp1.conversation_id
       where cp1.account_id = auth.uid()
    )
  );

-- Telefon i reszta konta rozmówcy nie są już odsłaniane (zostaje właściciel i administrator).
drop policy if exists "Konto widoczne, jeśli dzielimy rozmowę" on accounts;
