-- Dwa kolejne powiadomienia push (Paweł, 2026-10-02):
--  4) PZT opublikował listę startową na turniej, na który jadę,
--  5) przypomnienia: dzień przed turniejem i tydzień przed, gdy wciąż brakuje
--     transportu.

-- ── 4) Lista startowa opublikowana ────────────────────────────────────────
-- Jednorazowy bilet per turniej: pierwszy udany import listy (scripts/
-- import_tournament_entries.py) wysyła push do wszystkich z wyjazdem na ten
-- turniej. Turnieje, które już mają zapisaną listę, oznaczamy jako "wysłane",
-- żeby wdrożenie nie zalało nikogo zaległymi powiadomieniami.
alter table tournaments add column if not exists selection_push_at timestamptz;

update tournaments set selection_push_at = now()
 where selection_push_at is null
   and id in (select distinct tournament_id from tournament_entries);

-- ── 5) Przypomnienia przed turniejem ──────────────────────────────────────
alter table trips add column if not exists reminder_1d_sent_at timestamptz;
alter table trips add column if not exists reminder_7d_sent_at timestamptz;

-- Stan transportu/noclegu per wyjazd — wyciągnięty z trip_arrangements()
-- (0035), żeby te same reguły służyły ekranom aplikacji i przypomnieniom.
-- Wartości: 'arranged' | 'offering' | 'pending' | 'none'. Funkcje pomocnicze
-- są niedostępne z zewnątrz (revoke niżej) — wołają je tylko inne funkcje.
create or replace function trip_ride_status(p_trip_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select case
    when exists (select 1 from ride_join_requests r where r.requester_trip_id = p_trip_id and r.status = 'accepted')
      or exists (
        select 1 from ride_join_requests r join ride_offers o on o.id = r.ride_offer_id
         where o.trip_id = p_trip_id and r.status = 'accepted')
      or exists (select 1 from ride_pings p
                  where (p.requester_trip_id = p_trip_id or p.target_trip_id = p_trip_id) and p.status = 'accepted')
      then 'arranged'
    when exists (select 1 from ride_offers o where o.trip_id = p_trip_id) then 'offering'
    when exists (select 1 from ride_join_requests r where r.requester_trip_id = p_trip_id and r.status = 'pending')
      or exists (select 1 from ride_pings p
                  where (p.requester_trip_id = p_trip_id or p.target_trip_id = p_trip_id) and p.status = 'pending')
      then 'pending'
    else 'none'
  end;
$$;

create or replace function trip_lodging_status(p_trip_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select case
    when exists (select 1 from lodging_join_requests r where r.requester_trip_id = p_trip_id and r.status = 'accepted')
      or exists (
        select 1 from lodging_join_requests r join lodging_offers o on o.id = r.lodging_offer_id
         where o.trip_id = p_trip_id and r.status = 'accepted')
      or exists (select 1 from lodging_host_requests h where h.requester_trip_id = p_trip_id and h.status = 'accepted')
      then 'arranged'
    when exists (select 1 from lodging_offers o where o.trip_id = p_trip_id) then 'offering'
    when exists (select 1 from lodging_join_requests r where r.requester_trip_id = p_trip_id and r.status = 'pending')
      or exists (select 1 from lodging_host_requests h where h.requester_trip_id = p_trip_id and h.status = 'pending')
      then 'pending'
    else 'none'
  end;
$$;

revoke all on function trip_ride_status(uuid) from public, anon, authenticated;
revoke all on function trip_lodging_status(uuid) from public, anon, authenticated;

create or replace function trip_arrangements()
returns table (trip_id uuid, ride_status text, lodging_status text)
language sql
security definer
set search_path = public
stable
as $$
  select t.id, trip_ride_status(t.id), trip_lodging_status(t.id)
  from trips t
  where t.created_by_account_id = auth.uid()
     or player_visible_to_my_coach(t.player_id);
$$;

revoke all on function trip_arrangements() from public, anon;
grant execute on function trip_arrangements() to authenticated;

-- "Zajmuje" przypomnienia do wysłania i od razu oznacza je jako wysłane
-- (jednorazowo na wyjazd). days=1: każdy wyjazd na turniej startujący jutro.
-- days=7: tylko wyjazdy na turniej za tydzień, którym wciąż brakuje transportu.
-- Wołana z Edge Function (service_role) przez codzienne zadanie GitHub Actions.
create or replace function claim_trip_reminders(p_days int)
returns table (account_id uuid, tournament_name text, ride_status text, lodging_status text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_days = 1 then
    return query
    with claimed as (
      update trips t set reminder_1d_sent_at = now()
        from tournaments tn
       where tn.id = t.tournament_id
         and tn.starts_on = current_date + 1
         and t.reminder_1d_sent_at is null
         and t.status <> 'completed'
      returning t.id as trip_id, t.created_by_account_id as acc, tn.name as tname
    )
    select c.acc, c.tname, trip_ride_status(c.trip_id), trip_lodging_status(c.trip_id) from claimed c;
  elsif p_days = 7 then
    return query
    with claimed as (
      update trips t set reminder_7d_sent_at = now()
        from tournaments tn
       where tn.id = t.tournament_id
         and tn.starts_on = current_date + 7
         and t.reminder_7d_sent_at is null
         and t.status <> 'completed'
         and trip_ride_status(t.id) in ('none', 'pending')
      returning t.id as trip_id, t.created_by_account_id as acc, tn.name as tname
    )
    select c.acc, c.tname, trip_ride_status(c.trip_id), trip_lodging_status(c.trip_id) from claimed c;
  end if;
end;
$$;

revoke all on function claim_trip_reminders(int) from public, anon, authenticated;
grant execute on function claim_trip_reminders(int) to service_role;
