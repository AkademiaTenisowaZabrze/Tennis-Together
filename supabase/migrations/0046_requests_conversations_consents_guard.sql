-- Obejścia akceptacji, cudze rozmowy i zgody rodziców (audyt bezpieczeństwa 2026-10-03: F7, F9, F10, F11).
--
-- F9  Pasażer mógł wstawić prośbę od razu jako 'accepted' (obejście zgody kierowcy), a po akceptacji
--     przepiąć ją na ofertę innego kierowcy; kierowca mógł przepiąć prośbę na wyjazd obcej rodziny.
--     Teraz: nowa prośba/zapytanie zawsze startuje jako 'pending', identyfikatory (oferta, wyjazd
--     proszącego) są niezmienne, a status zmienia się tylko po dozwolonych przejściach.
-- F10 Strona zaakceptowanej prośby mogła dodać swojego partnera do DOWOLNEJ, także cudzej rozmowy
--     (i tym samym czytać cudze wiadomości). Teraz do rozmowy można dodawać tylko wtedy, gdy jest
--     pusta (świeżo założona) albo dodający jest już jej uczestnikiem. Dodatkowo dodający może
--     dopisać siebie (klient wstawia oba wiersze jednym zapytaniem: siebie i drugą stronę).
-- F11 Zgodę na nocleg u rodziny mógł dodać ktokolwiek dla cudzego zawodnika. Teraz tylko właściciel
--     zawodnika.
-- F7  Rodzic nie mógł wycofać zgody, a wycofanie nie blokowało nowych próśb o nocleg u rodziny.
--     Teraz właściciel zgody może zmienić jej pole `granted` (inne pola zamrożone), a prośba o nocleg
--     u rodziny wymaga, żeby NAJNOWSZA zgoda dla zawodnika była udzielona.
--
-- Wszystkie strażniki pomijają kontekst bez użytkownika (auth.uid() puste: SQL Editor, service_role,
-- skrypty), jak w 0041 i 0043.

-- ── F9: strażnik wierszy próśb ────────────────────────────────────────────

create or replace function guard_request_row()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  k text;
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    return new;
  end if;

  foreach k in array tg_argv loop
    if to_jsonb(new) ->> k is distinct from to_jsonb(old) ->> k then
      raise exception 'Pole % nie może być zmienione.', k using errcode = '42501';
    end if;
  end loop;

  if new.status is distinct from old.status
     and not (
       (old.status = 'pending' and new.status in ('accepted', 'declined', 'cancelled'))
       or (old.status = 'accepted' and new.status = 'cancelled')
     ) then
    raise exception 'Niedozwolona zmiana statusu (% -> %).', old.status, new.status using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_request_row_ride on ride_join_requests;
create trigger guard_request_row_ride
  before insert or update on ride_join_requests
  for each row execute function guard_request_row('ride_offer_id', 'requester_trip_id');

drop trigger if exists guard_request_row_lodging on lodging_join_requests;
create trigger guard_request_row_lodging
  before insert or update on lodging_join_requests
  for each row execute function guard_request_row('lodging_offer_id', 'requester_trip_id');

-- Zapytania o podwiezienie mają własny strażnik przejść (0028); tu tylko wymuszenie startu jako 'pending'.
create or replace function force_pending_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.status := 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists force_pending_ride_ping on ride_pings;
create trigger force_pending_ride_ping
  before insert on ride_pings
  for each row execute function force_pending_status();

-- ── F10: uczestnicy rozmowy ───────────────────────────────────────────────

-- Czy do rozmowy wolno dopisywać: jest pusta (świeżo założona) albo dopisujący już w niej jest.
create or replace function conversation_open_for_me(conv_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (select 1 from conversation_participants where conversation_id = conv_id)
         or exists (select 1 from conversation_participants where conversation_id = conv_id and account_id = auth.uid());
$$;

-- Czy zalogowany jest stroną jakiejkolwiek zaakceptowanej prośby/zapytania (przejazd, nocleg, podwiezienie, rodzina).
create or replace function i_am_party_of_accepted_request()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
           select 1 from ride_join_requests rjr
             join ride_offers ro on ro.id = rjr.ride_offer_id
             join trips ot on ot.id = ro.trip_id
             join trips rt on rt.id = rjr.requester_trip_id
            where rjr.status = 'accepted' and auth.uid() in (ot.created_by_account_id, rt.created_by_account_id))
      or exists (
           select 1 from lodging_join_requests ljr
             join lodging_offers lo on lo.id = ljr.lodging_offer_id
             join trips ot on ot.id = lo.trip_id
             join trips rt on rt.id = ljr.requester_trip_id
            where ljr.status = 'accepted' and auth.uid() in (ot.created_by_account_id, rt.created_by_account_id))
      or exists (
           select 1 from ride_pings rp
             join trips rqt on rqt.id = rp.requester_trip_id
             join trips tgt on tgt.id = rp.target_trip_id
            where rp.status = 'accepted' and auth.uid() in (rqt.created_by_account_id, tgt.created_by_account_id))
      or exists (
           select 1 from lodging_host_requests lhr
             join lodging_host_offers lho on lho.id = lhr.host_offer_id
             join trips rt on rt.id = lhr.requester_trip_id
            where lhr.status = 'accepted' and auth.uid() in (lho.host_account_id, rt.created_by_account_id));
$$;

-- Czy zalogowany i p_other są dwiema stronami zaakceptowanego ustalenia (przejazd, nocleg, podwiezienie, rodzina).
-- SECURITY DEFINER, bo zwykły użytkownik nie widzi wyjazdu drugiej strony (RLS na trips), więc sprawdzenie
-- wykonane jego uprawnieniami nigdy nie przechodziło np. dla zapytań o podwiezienie.
create or replace function is_accepted_counterpart(p_other uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
           select 1 from ride_join_requests rjr
             join ride_offers ro on ro.id = rjr.ride_offer_id
             join trips ot on ot.id = ro.trip_id
             join trips rt on rt.id = rjr.requester_trip_id
            where rjr.status = 'accepted'
              and ((auth.uid() = ot.created_by_account_id and p_other = rt.created_by_account_id)
                or (auth.uid() = rt.created_by_account_id and p_other = ot.created_by_account_id)))
      or exists (
           select 1 from lodging_join_requests ljr
             join lodging_offers lo on lo.id = ljr.lodging_offer_id
             join trips ot on ot.id = lo.trip_id
             join trips rt on rt.id = ljr.requester_trip_id
            where ljr.status = 'accepted'
              and ((auth.uid() = ot.created_by_account_id and p_other = rt.created_by_account_id)
                or (auth.uid() = rt.created_by_account_id and p_other = ot.created_by_account_id)))
      or exists (
           select 1 from ride_pings rp
             join trips rqt on rqt.id = rp.requester_trip_id
             join trips tgt on tgt.id = rp.target_trip_id
            where rp.status = 'accepted'
              and ((auth.uid() = rqt.created_by_account_id and p_other = tgt.created_by_account_id)
                or (auth.uid() = tgt.created_by_account_id and p_other = rqt.created_by_account_id)))
      or exists (
           select 1 from lodging_host_requests lhr
             join lodging_host_offers lho on lho.id = lhr.host_offer_id
             join trips rt on rt.id = lhr.requester_trip_id
            where lhr.status = 'accepted'
              and ((auth.uid() = lho.host_account_id and p_other = rt.created_by_account_id)
                or (auth.uid() = rt.created_by_account_id and p_other = lho.host_account_id)));
$$;

revoke all on function conversation_open_for_me(uuid) from public, anon;
revoke all on function i_am_party_of_accepted_request() from public, anon;
revoke all on function is_accepted_counterpart(uuid) from public, anon;
grant execute on function conversation_open_for_me(uuid), i_am_party_of_accepted_request(), is_accepted_counterpart(uuid) to authenticated;

drop policy if exists "Strony zaakceptowanej prośby otwierają wspólną rozmowę" on conversation_participants;
create policy "Strony zaakceptowanej prośby otwierają wspólną rozmowę"
  on conversation_participants for insert
  to authenticated
  with check (
    conversation_open_for_me(conversation_id)
    and (
      -- dopisanie siebie (klient wstawia oba wiersze naraz)
      (account_id = auth.uid() and i_am_party_of_accepted_request())
      -- dopisanie drugiej strony zaakceptowanego ustalenia
      or is_accepted_counterpart(account_id)
    )
  );

-- ── F11 + F7: zgody rodziców ──────────────────────────────────────────────

drop policy if exists "Właściciel dodaje własne zgody" on consents;
create policy "Właściciel dodaje własne zgody"
  on consents for insert
  to authenticated
  with check (
    given_by_account_id = auth.uid()
    and exists (select 1 from players p where p.id = player_id and p.owner_account_id = auth.uid())
  );

-- Wycofanie zgody = zmiana `granted` (wiersz zostaje jako ślad). Reszta wiersza jest zamrożona.
create policy "Właściciel zmienia stan własnej zgody"
  on consents for update
  to authenticated
  using (given_by_account_id = auth.uid())
  with check (given_by_account_id = auth.uid());

create or replace function guard_consent_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.player_id := old.player_id;
    new.given_by_account_id := old.given_by_account_id;
    new.consent_type := old.consent_type;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_consent_columns on consents;
create trigger guard_consent_columns
  before update on consents
  for each row execute function guard_consent_columns();

-- Prośba o nocleg u rodziny: liczy się NAJNOWSZA zgoda dla zawodnika (wycofanie ją unieważnia).
drop policy if exists "Zgłaszający wysyła prośbę (wymaga zgody rodzica)" on lodging_host_requests;
create policy "Zgłaszający wysyła prośbę (wymaga zgody rodzica)"
  on lodging_host_requests for insert
  to authenticated
  with check (
    status = 'pending'
    and exists (
      select 1
      from trips t
      where t.id = requester_trip_id
        and t.created_by_account_id = auth.uid()
        and coalesce((
          select c.granted
            from consents c
           where c.player_id = t.player_id
             and c.consent_type = 'host_family_stay'
           order by c.created_at desc, c.id desc
           limit 1
        ), false)
    )
  );
