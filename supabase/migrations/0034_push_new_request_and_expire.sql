-- Dwie rzeczy (Paweł, 2026-10-02):
--  1) push dla WŁAŚCICIELA oferty, gdy ktoś o coś poprosi (uzupełnienie
--     0033, które powiadamia proszącego o akceptacji),
--  2) automatyczne wygaszanie próśb, które wiszą jako "oczekuje", a turniej
--     już się odbył.

-- ── 1) Nowa prośba -> push do właściciela ─────────────────────────────────

alter table ride_join_requests add column if not exists created_push_sent_at timestamptz;
alter table lodging_join_requests add column if not exists created_push_sent_at timestamptz;
alter table ride_pings add column if not exists created_push_sent_at timestamptz;
alter table lodging_host_requests add column if not exists created_push_sent_at timestamptz;

-- Istniejące prośby oznaczamy jako "wysłane" (jak w 0033), żeby nikt nie
-- mógł wywołać zaległych powiadomień o starych prośbach.
update ride_join_requests set created_push_sent_at = now() where created_push_sent_at is null;
update lodging_join_requests set created_push_sent_at = now() where created_push_sent_at is null;
update ride_pings set created_push_sent_at = now() where created_push_sent_at is null;
update lodging_host_requests set created_push_sent_at = now() where created_push_sent_at is null;

create or replace function notify_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://jrabxtiranllayerhutm.supabase.co/functions/v1/notify-tournament',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_8-yxyMhoEEq-kHx2opU0Pg_QylogBur'
    ),
    body := jsonb_build_object(
      'event', 'request_created',
      'request_kind', TG_ARGV[0],
      'request_id', new.id
    )
  );
  return new;
end;
$$;

drop trigger if exists on_ride_request_created on ride_join_requests;
create trigger on_ride_request_created
  after insert on ride_join_requests
  for each row execute function notify_request_created('ride');

drop trigger if exists on_lodging_request_created on lodging_join_requests;
create trigger on_lodging_request_created
  after insert on lodging_join_requests
  for each row execute function notify_request_created('lodging');

drop trigger if exists on_ride_ping_created on ride_pings;
create trigger on_ride_ping_created
  after insert on ride_pings
  for each row execute function notify_request_created('ride_ping');

drop trigger if exists on_host_request_created on lodging_host_requests;
create trigger on_host_request_created
  after insert on lodging_host_requests
  for each row execute function notify_request_created('host_lodging');

-- ── 2) Wygaszanie przeterminowanych próśb ─────────────────────────────────
-- Dwa triggery pilnujące przejść statusu (ride_pings 0028, noclegi u rodziny
-- 0031) odrzucałyby "pending -> cancelled" wykonane przez system (brak
-- auth.uid()), więc dostają wyjątek: ustawiony przez expire_stale_requests()
-- znacznik tt.expire_rpc pozwala im przepuścić tę jedną operację.

create or replace function guard_ride_ping_transition()
returns trigger
language plpgsql
as $$
declare
  v_uid uuid := auth.uid();
  v_is_target boolean;
  v_is_requester boolean;
begin
  if coalesce(current_setting('tt.expire_rpc', true), '') = 'on' then
    return new;
  end if;

  if new.requester_trip_id is distinct from old.requester_trip_id
     or new.target_trip_id is distinct from old.target_trip_id
     or new.tournament_id is distinct from old.tournament_id then
    raise exception 'Nie można zmienić stron zapytania o podwiezienie.';
  end if;

  if new.status is distinct from old.status then
    v_is_target := old.target_trip_id in (select id from trips where created_by_account_id = v_uid);
    v_is_requester := old.requester_trip_id in (select id from trips where created_by_account_id = v_uid);

    if new.status in ('accepted', 'declined') then
      if old.status <> 'pending' or not v_is_target then
        raise exception 'Tylko druga strona może odpowiedzieć na oczekujące zapytanie.';
      end if;
    elsif new.status = 'cancelled' then
      if old.status not in ('pending', 'accepted') or not (v_is_target or v_is_requester) then
        raise exception 'Nie można anulować tego zapytania.';
      end if;
    else
      raise exception 'Nieprawidłowa zmiana statusu zapytania o podwiezienie.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function guard_host_request_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_host boolean;
  is_requester boolean;
begin
  if coalesce(current_setting('tt.expire_rpc', true), '') = 'on' then
    return new;
  end if;

  is_host := exists (
    select 1 from lodging_host_offers o where o.id = new.host_offer_id and o.host_account_id = auth.uid()
  );
  is_requester := exists (
    select 1 from trips t where t.id = new.requester_trip_id and t.created_by_account_id = auth.uid()
  );

  if new.host_offer_id <> old.host_offer_id or new.requester_trip_id <> old.requester_trip_id then
    raise exception 'Nie można zmienić stron zgłoszenia';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if old.status = 'pending' and new.status in ('accepted', 'declined') then
    if not is_host then
      raise exception 'Tylko gospodarz może zaakceptować lub odrzucić zgłoszenie';
    end if;
  elsif old.status in ('pending', 'accepted') and new.status = 'cancelled' then
    if not (is_host or is_requester) then
      raise exception 'Brak uprawnień do anulowania zgłoszenia';
    end if;
  else
    raise exception 'Niedozwolone przejście statusu: % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;

-- Wywoływana raz dziennie przez scripts/import_tournaments.py (GitHub
-- Actions, klucz service_role) — NIE przez użytkowników (revoke niżej).
-- "Przeterminowana" = prośba oczekująca, a turniej jej wyjazdu już się
-- zakończył: ends_on wcześniejsze niż dziś, a gdy go brak (import OTK nie
-- podaje daty końca) — 7 dni po starcie, żeby nie wygasić próśb na turniej,
-- który właśnie trwa.
create or replace function expire_stale_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_ride int;
  n_lodging int;
  n_ping int;
  n_host int;
begin
  perform set_config('tt.expire_rpc', 'on', true);

  update ride_join_requests r set status = 'cancelled'
    from trips t join tournaments tn on tn.id = t.tournament_id
   where r.requester_trip_id = t.id and r.status = 'pending'
     and coalesce(tn.ends_on, tn.starts_on + 7) < current_date;
  get diagnostics n_ride = row_count;

  update lodging_join_requests r set status = 'cancelled'
    from trips t join tournaments tn on tn.id = t.tournament_id
   where r.requester_trip_id = t.id and r.status = 'pending'
     and coalesce(tn.ends_on, tn.starts_on + 7) < current_date;
  get diagnostics n_lodging = row_count;

  update ride_pings p set status = 'cancelled'
    from tournaments tn
   where tn.id = p.tournament_id and p.status = 'pending'
     and coalesce(tn.ends_on, tn.starts_on + 7) < current_date;
  get diagnostics n_ping = row_count;

  update lodging_host_requests r set status = 'cancelled'
    from trips t join tournaments tn on tn.id = t.tournament_id
   where r.requester_trip_id = t.id and r.status = 'pending'
     and coalesce(tn.ends_on, tn.starts_on + 7) < current_date;
  get diagnostics n_host = row_count;

  return jsonb_build_object('ride', n_ride, 'lodging', n_lodging, 'ride_ping', n_ping, 'host_lodging', n_host);
end;
$$;

revoke all on function expire_stale_requests() from public, anon, authenticated;
grant execute on function expire_stale_requests() to service_role;
