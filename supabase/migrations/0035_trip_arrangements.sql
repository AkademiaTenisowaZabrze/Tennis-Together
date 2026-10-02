-- Stan załatwienia transportu i noclegu dla wyjazdów (Paweł, 2026-10-02):
--  * karta wyjazdu w "Moje wyjazdy" pokazywała na sztywno "Jeszcze nikt się
--    nie zgłosił" niezależnie od stanu rzeczy,
--  * trener w panelu klubu nie widział, komu z zawodników brakuje transportu
--    albo noclegu.
--
-- Funkcja zwraca tylko gruby stan (nic o tym, Z KIM), dla wyjazdów, które
-- widzi wywołujący: własnych oraz — dla trenera — zawodników jego klubu
-- (player_visible_to_my_coach, 0012). SECURITY DEFINER, bo trener nie ma
-- wglądu w cudze prośby (RLS), a sam stan "załatwione/nie" nie ujawnia
-- szczegółów.
--
-- Wartości: 'arranged' (jest zaakceptowana prośba/zapytanie), 'offering'
-- (wyjazd ma własną ofertę, ale nic zaakceptowanego), 'pending' (czeka
-- prośba), 'none'.

create or replace function trip_arrangements()
returns table (trip_id uuid, ride_status text, lodging_status text)
language sql
security definer
set search_path = public
stable
as $$
  select
    t.id,
    case
      when exists (select 1 from ride_join_requests r where r.requester_trip_id = t.id and r.status = 'accepted')
        or exists (
          select 1 from ride_join_requests r join ride_offers o on o.id = r.ride_offer_id
           where o.trip_id = t.id and r.status = 'accepted')
        or exists (select 1 from ride_pings p
                    where (p.requester_trip_id = t.id or p.target_trip_id = t.id) and p.status = 'accepted')
        then 'arranged'
      when exists (select 1 from ride_offers o where o.trip_id = t.id) then 'offering'
      when exists (select 1 from ride_join_requests r where r.requester_trip_id = t.id and r.status = 'pending')
        or exists (select 1 from ride_pings p
                    where (p.requester_trip_id = t.id or p.target_trip_id = t.id) and p.status = 'pending')
        then 'pending'
      else 'none'
    end,
    case
      when exists (select 1 from lodging_join_requests r where r.requester_trip_id = t.id and r.status = 'accepted')
        or exists (
          select 1 from lodging_join_requests r join lodging_offers o on o.id = r.lodging_offer_id
           where o.trip_id = t.id and r.status = 'accepted')
        or exists (select 1 from lodging_host_requests h where h.requester_trip_id = t.id and h.status = 'accepted')
        then 'arranged'
      when exists (select 1 from lodging_offers o where o.trip_id = t.id) then 'offering'
      when exists (select 1 from lodging_join_requests r where r.requester_trip_id = t.id and r.status = 'pending')
        or exists (select 1 from lodging_host_requests h where h.requester_trip_id = t.id and h.status = 'pending')
        then 'pending'
      else 'none'
    end
  from trips t
  where t.created_by_account_id = auth.uid()
     or player_visible_to_my_coach(t.player_id);
$$;

revoke all on function trip_arrangements() from public, anon;
grant execute on function trip_arrangements() to authenticated;
