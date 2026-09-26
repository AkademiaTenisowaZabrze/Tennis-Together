-- Potwierdzenie spotkania weryfikowane w bazie, nie w przeglądarce.
--
-- Audyt (2026-09-16) wykazał, że 0018 pozwalało każdej stronie zaakceptowanego
-- przejazdu/noclegu ustawić `meeting_confirmed_at` zwykłym zapytaniem do API,
-- bez znajomości kodu. Ponieważ `can_rate()` (0022) opiera się wyłącznie na
-- `meeting_confirmed_at`, dwa zmówione konta mogły odblokować sobie wzajemne
-- oceny bez żadnego spotkania.
--
-- Teraz:
--  * potwierdzić można tylko funkcją `confirm_meeting()` (SECURITY DEFINER),
--    która sprawdza kod, blokuje potwierdzanie własnym kodem i liczy próby
--    (5 błędnych i kod się blokuje, trzeba wygenerować nowy);
--  * trigger odrzuca każdą inną próbę zmiany kolumn potwierdzenia.

alter table ride_join_requests
  add column if not exists meeting_code_by uuid references accounts(id),
  add column if not exists meeting_attempts int not null default 0;

alter table lodging_join_requests
  add column if not exists meeting_code_by uuid references accounts(id),
  add column if not exists meeting_attempts int not null default 0;

create or replace function guard_meeting_columns()
returns trigger
language plpgsql
as $$
begin
  -- funkcja confirm_meeting() ustawia ten znacznik na czas swojej transakcji
  if coalesce(current_setting('tt.meeting_rpc', true), '') = 'on' then
    return new;
  end if;

  if new.meeting_confirmed_at is distinct from old.meeting_confirmed_at
     or new.meeting_confirmed_by is distinct from old.meeting_confirmed_by then
    raise exception 'Spotkanie można potwierdzić tylko kodem (confirm_meeting).';
  end if;

  if new.meeting_code is distinct from old.meeting_code then
    if old.meeting_confirmed_at is not null then
      raise exception 'Spotkanie jest już potwierdzone.';
    end if;
    new.meeting_code_by := auth.uid();
    new.meeting_attempts := 0;
  else
    new.meeting_code_by := old.meeting_code_by;
    new.meeting_attempts := old.meeting_attempts;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_meeting_columns_ride on ride_join_requests;
create trigger guard_meeting_columns_ride
  before update on ride_join_requests
  for each row execute function guard_meeting_columns();

drop trigger if exists guard_meeting_columns_lodging on lodging_join_requests;
create trigger guard_meeting_columns_lodging
  before update on lodging_join_requests
  for each row execute function guard_meeting_columns();

create or replace function confirm_meeting(p_request_id uuid, p_kind text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_status text;
  v_saved_code text;
  v_code_by uuid;
  v_attempts int;
  v_confirmed timestamptz;
  v_is_party boolean;
begin
  if v_uid is null then
    return jsonb_build_object('result', 'forbidden');
  end if;

  if p_kind = 'ride' then
    select r.status, r.meeting_code, r.meeting_code_by, r.meeting_attempts, r.meeting_confirmed_at,
           (t_req.created_by_account_id = v_uid or t_off.created_by_account_id = v_uid)
      into v_status, v_saved_code, v_code_by, v_attempts, v_confirmed, v_is_party
      from ride_join_requests r
      join trips t_req on t_req.id = r.requester_trip_id
      join ride_offers o on o.id = r.ride_offer_id
      join trips t_off on t_off.id = o.trip_id
     where r.id = p_request_id
       for update of r;
  elsif p_kind = 'lodging' then
    select r.status, r.meeting_code, r.meeting_code_by, r.meeting_attempts, r.meeting_confirmed_at,
           (t_req.created_by_account_id = v_uid or t_off.created_by_account_id = v_uid)
      into v_status, v_saved_code, v_code_by, v_attempts, v_confirmed, v_is_party
      from lodging_join_requests r
      join trips t_req on t_req.id = r.requester_trip_id
      join lodging_offers o on o.id = r.lodging_offer_id
      join trips t_off on t_off.id = o.trip_id
     where r.id = p_request_id
       for update of r;
  else
    return jsonb_build_object('result', 'forbidden');
  end if;

  if v_is_party is not true or v_status is distinct from 'accepted' then
    return jsonb_build_object('result', 'forbidden');
  end if;
  if v_confirmed is not null then
    return jsonb_build_object('result', 'already');
  end if;
  if v_saved_code is null then
    return jsonb_build_object('result', 'no_code');
  end if;
  if v_code_by = v_uid then
    return jsonb_build_object('result', 'own_code');
  end if;
  if v_attempts >= 5 then
    return jsonb_build_object('result', 'locked');
  end if;

  perform set_config('tt.meeting_rpc', 'on', true);

  if v_code <> v_saved_code then
    if p_kind = 'ride' then
      update ride_join_requests set meeting_attempts = meeting_attempts + 1 where id = p_request_id;
    else
      update lodging_join_requests set meeting_attempts = meeting_attempts + 1 where id = p_request_id;
    end if;
    return jsonb_build_object('result', 'mismatch', 'attempts_left', greatest(4 - v_attempts, 0));
  end if;

  if p_kind = 'ride' then
    update ride_join_requests
       set meeting_confirmed_at = now(), meeting_confirmed_by = v_uid
     where id = p_request_id;
  else
    update lodging_join_requests
       set meeting_confirmed_at = now(), meeting_confirmed_by = v_uid
     where id = p_request_id;
  end if;

  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function confirm_meeting(uuid, text, text) from public, anon;
grant execute on function confirm_meeting(uuid, text, text) to authenticated;
