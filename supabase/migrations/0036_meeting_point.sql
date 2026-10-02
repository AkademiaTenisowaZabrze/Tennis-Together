-- Pineska "gdzie się spotykamy" (Paweł, 2026-10-02) — miejsce spotkania
-- kierowcy i zawodnika po zaakceptowaniu przejazdu albo prośby o
-- podwiezienie. Obie strony mogą je ustawić i zmienić; druga widzi je od razu.
--
-- Zapis TYLKO przez set_meeting_point() (SECURITY DEFINER), a nie zwykłym
-- UPDATE-em: polityki UPDATE na tych tabelach rozdzielają prawa kierowcy i
-- proszącego (0007, 0013), więc dopisywanie kolejnych wyjątków do nich byłoby
-- kruche (patrz uwaga o OR-owaniu polityk w 0026/0028). Funkcja sama sprawdza,
-- że wywołujący jest stroną ZAAKCEPTOWANEJ prośby, i waliduje współrzędne.

alter table ride_join_requests
  add column if not exists meeting_lat double precision,
  add column if not exists meeting_lng double precision,
  add column if not exists meeting_place text,
  add column if not exists meeting_point_set_by uuid references accounts(id),
  add column if not exists meeting_point_set_at timestamptz;

alter table ride_pings
  add column if not exists meeting_lat double precision,
  add column if not exists meeting_lng double precision,
  add column if not exists meeting_place text,
  add column if not exists meeting_point_set_by uuid references accounts(id),
  add column if not exists meeting_point_set_at timestamptz;

-- p_lat/p_lng = null czyści pineskę.
create or replace function set_meeting_point(
  p_kind text,
  p_request_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_place text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_is_party boolean;
  v_place text := nullif(left(trim(coalesce(p_place, '')), 120), '');
  v_clear boolean := p_lat is null and p_lng is null;
begin
  if v_uid is null then
    return jsonb_build_object('result', 'forbidden');
  end if;

  if not v_clear then
    if p_lat is null or p_lng is null
       or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
      return jsonb_build_object('result', 'invalid');
    end if;
  end if;

  if p_kind = 'ride' then
    select r.status, (t_req.created_by_account_id = v_uid or t_off.created_by_account_id = v_uid)
      into v_status, v_is_party
      from ride_join_requests r
      join trips t_req on t_req.id = r.requester_trip_id
      join ride_offers o on o.id = r.ride_offer_id
      join trips t_off on t_off.id = o.trip_id
     where r.id = p_request_id
       for update of r;
  elsif p_kind = 'ride_ping' then
    select p.status, (t_req.created_by_account_id = v_uid or t_tgt.created_by_account_id = v_uid)
      into v_status, v_is_party
      from ride_pings p
      join trips t_req on t_req.id = p.requester_trip_id
      join trips t_tgt on t_tgt.id = p.target_trip_id
     where p.id = p_request_id
       for update of p;
  else
    return jsonb_build_object('result', 'forbidden');
  end if;

  if v_is_party is not true or v_status is distinct from 'accepted' then
    return jsonb_build_object('result', 'forbidden');
  end if;

  if p_kind = 'ride' then
    update ride_join_requests
       set meeting_lat = p_lat, meeting_lng = p_lng,
           meeting_place = case when v_clear then null else v_place end,
           meeting_point_set_by = case when v_clear then null else v_uid end,
           meeting_point_set_at = case when v_clear then null else now() end
     where id = p_request_id;
  else
    update ride_pings
       set meeting_lat = p_lat, meeting_lng = p_lng,
           meeting_place = case when v_clear then null else v_place end,
           meeting_point_set_by = case when v_clear then null else v_uid end,
           meeting_point_set_at = case when v_clear then null else now() end
     where id = p_request_id;
  end if;

  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function set_meeting_point(text, uuid, double precision, double precision, text) from public, anon;
grant execute on function set_meeting_point(text, uuid, double precision, double precision, text) to authenticated;
