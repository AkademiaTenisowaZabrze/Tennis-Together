-- Dopisuje "Nocleg u zawodnika" (0031) do dwóch mechanizmów zaufania,
-- które reszta aplikacji już ma: potwierdzenie spotkania kodem/QR
-- (0026_meeting_confirmation_server_side.sql) i oceny po spotkaniu
-- (0022_ratings.sql). Świadomie pominięte przy pierwszym wdrożeniu 0031 —
-- to jest ten "naturalny kolejny krok".

alter table lodging_host_requests
  add column if not exists meeting_code text,
  add column if not exists meeting_confirmed_at timestamptz,
  add column if not exists meeting_confirmed_by uuid references accounts(id),
  add column if not exists meeting_code_by uuid references accounts(id),
  add column if not exists meeting_attempts int not null default 0;

-- guard_meeting_columns() (0026) już jest w pełni ogólna (operuje tylko na
-- NEW/OLD kolumnach, nie na nazwie tabeli) — wystarczy dopiąć trigger.
drop trigger if exists guard_meeting_columns_host_lodging on lodging_host_requests;
create trigger guard_meeting_columns_host_lodging
  before update on lodging_host_requests
  for each row execute function guard_meeting_columns();

-- confirm_meeting(): trzecia gałąź obok 'ride'/'lodging'.
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
  elsif p_kind = 'host_lodging' then
    select r.status, r.meeting_code, r.meeting_code_by, r.meeting_attempts, r.meeting_confirmed_at,
           (t_req.created_by_account_id = v_uid or o.host_account_id = v_uid)
      into v_status, v_saved_code, v_code_by, v_attempts, v_confirmed, v_is_party
      from lodging_host_requests r
      join trips t_req on t_req.id = r.requester_trip_id
      join lodging_host_offers o on o.id = r.host_offer_id
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
    elsif p_kind = 'lodging' then
      update lodging_join_requests set meeting_attempts = meeting_attempts + 1 where id = p_request_id;
    else
      update lodging_host_requests set meeting_attempts = meeting_attempts + 1 where id = p_request_id;
    end if;
    return jsonb_build_object('result', 'mismatch', 'attempts_left', greatest(4 - v_attempts, 0));
  end if;

  if p_kind = 'ride' then
    update ride_join_requests
       set meeting_confirmed_at = now(), meeting_confirmed_by = v_uid
     where id = p_request_id;
  elsif p_kind = 'lodging' then
    update lodging_join_requests
       set meeting_confirmed_at = now(), meeting_confirmed_by = v_uid
     where id = p_request_id;
  else
    update lodging_host_requests
       set meeting_confirmed_at = now(), meeting_confirmed_by = v_uid
     where id = p_request_id;
  end if;

  return jsonb_build_object('result', 'ok');
end;
$$;

-- can_rate(): trzecia gałąź obok 'ride'/'lodging'.
create or replace function can_rate(p_join_request_id uuid, p_kind text, p_other_account_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case p_kind
    when 'ride' then exists (
      select 1
      from ride_join_requests rjr
      join ride_offers ro on ro.id = rjr.ride_offer_id
      join trips ot on ot.id = ro.trip_id
      join trips rt on rt.id = rjr.requester_trip_id
      where rjr.id = p_join_request_id
        and rjr.meeting_confirmed_at is not null
        and (
          (ot.created_by_account_id = auth.uid() and rt.created_by_account_id = p_other_account_id)
          or (rt.created_by_account_id = auth.uid() and ot.created_by_account_id = p_other_account_id)
        )
    )
    when 'lodging' then exists (
      select 1
      from lodging_join_requests ljr
      join lodging_offers lo on lo.id = ljr.lodging_offer_id
      join trips ot on ot.id = lo.trip_id
      join trips rt on rt.id = ljr.requester_trip_id
      where ljr.id = p_join_request_id
        and ljr.meeting_confirmed_at is not null
        and (
          (ot.created_by_account_id = auth.uid() and rt.created_by_account_id = p_other_account_id)
          or (rt.created_by_account_id = auth.uid() and ot.created_by_account_id = p_other_account_id)
        )
    )
    when 'host_lodging' then exists (
      select 1
      from lodging_host_requests lhr
      join lodging_host_offers lho on lho.id = lhr.host_offer_id
      join trips rt on rt.id = lhr.requester_trip_id
      where lhr.id = p_join_request_id
        and lhr.meeting_confirmed_at is not null
        and (
          (lho.host_account_id = auth.uid() and rt.created_by_account_id = p_other_account_id)
          or (rt.created_by_account_id = auth.uid() and lho.host_account_id = p_other_account_id)
        )
    )
    else false
  end;
$$;

alter table ratings drop constraint if exists ratings_join_request_kind_check;
alter table ratings add constraint ratings_join_request_kind_check
  check (join_request_kind in ('ride', 'lodging', 'host_lodging'));
