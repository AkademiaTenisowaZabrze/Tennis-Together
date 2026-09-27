-- "Poproś o podwiezienie" — zapytanie wysyłane bezpośrednio do zawodnika
-- dopasowanego z oficjalnej listy startowej PZT (patrz 0027 i
-- find_pzt_tournament_matches()), niezależnie od tego, czy druga strona
-- wystawiła już ofertę przejazdu w zakładce Przejazdy. Po zaakceptowaniu
-- otwiera się wspólna rozmowa — ten sam mechanizm co przy akceptacji
-- zwykłej prośby o dołączenie (0008_messages_rls.sql), tylko trzecie
-- źródło rozmowy obok ride_join_requests/lodging_join_requests.

create table ride_pings (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  requester_trip_id uuid not null references trips(id) on delete cascade,
  target_trip_id uuid not null references trips(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (requester_trip_id, target_trip_id),
  check (requester_trip_id <> target_trip_id)
);

alter table ride_pings enable row level security;

create policy "Proszący wysyła zapytanie o podwiezienie z własnego wyjazdu"
  on ride_pings for insert to authenticated
  with check (requester_trip_id in (select id from trips where created_by_account_id = auth.uid()));

create policy "Strony widzą zapytanie o podwiezienie"
  on ride_pings for select to authenticated
  using (
    requester_trip_id in (select id from trips where created_by_account_id = auth.uid())
    or target_trip_id in (select id from trips where created_by_account_id = auth.uid())
  );

-- Kto może zmienić status i na co — pilnowane w triggerze (guard_ride_ping_transition),
-- nie w with check polityki: przy kilku PERMISSIVE politykach UPDATE Postgres
-- sumuje logicznym OR wszystkie klauzule USING osobno i wszystkie WITH CHECK
-- osobno (nie parami), więc "strona A może zrobić X, strona B może zrobić Y"
-- zapisane jako dwie osobne polityki de facto pozwoliłoby też na "strona A
-- robi Y" — dokładnie ten błąd znaleziony i naprawiony w 0026 dla potwierdzenia
-- spotkania. Trigger sprawdza to poprawnie, per-request, więc polityka niżej
-- może być jedna i szeroka.
create policy "Strony aktualizują zapytanie o podwiezienie"
  on ride_pings for update to authenticated
  using (
    requester_trip_id in (select id from trips where created_by_account_id = auth.uid())
    or target_trip_id in (select id from trips where created_by_account_id = auth.uid())
  )
  with check (true);

create or replace function guard_ride_ping_transition()
returns trigger
language plpgsql
as $$
declare
  v_uid uuid := auth.uid();
  v_is_target boolean;
  v_is_requester boolean;
begin
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

drop trigger if exists guard_ride_ping_transition on ride_pings;
create trigger guard_ride_ping_transition
  before update on ride_pings
  for each row execute function guard_ride_ping_transition();

-- ── Trzecie źródło rozmowy (obok oferty przejazdu/noclegu) ────────────────

alter table conversations
  add column if not exists ride_ping_id uuid references ride_pings(id) on delete cascade;

drop policy if exists "Strony zaakceptowanej prośby otwierają wspólną rozmowę" on conversation_participants;
create policy "Strony zaakceptowanej prośby otwierają wspólną rozmowę"
  on conversation_participants for insert to authenticated
  with check (
    exists (
      select 1 from ride_join_requests rjr
      join ride_offers ro on ro.id = rjr.ride_offer_id
      join trips ot on ot.id = ro.trip_id
      join trips rt on rt.id = rjr.requester_trip_id
      where rjr.status = 'accepted'
        and (
          (account_id = ot.created_by_account_id and auth.uid() = rt.created_by_account_id)
          or (account_id = rt.created_by_account_id and auth.uid() = ot.created_by_account_id)
        )
    )
    or exists (
      select 1 from lodging_join_requests ljr
      join lodging_offers lo on lo.id = ljr.lodging_offer_id
      join trips ot on ot.id = lo.trip_id
      join trips rt on rt.id = ljr.requester_trip_id
      where ljr.status = 'accepted'
        and (
          (account_id = ot.created_by_account_id and auth.uid() = rt.created_by_account_id)
          or (account_id = rt.created_by_account_id and auth.uid() = ot.created_by_account_id)
        )
    )
    or exists (
      select 1 from ride_pings rp
      join trips rqt on rqt.id = rp.requester_trip_id
      join trips tgt on tgt.id = rp.target_trip_id
      where rp.status = 'accepted'
        and (
          (account_id = rqt.created_by_account_id and auth.uid() = tgt.created_by_account_id)
          or (account_id = tgt.created_by_account_id and auth.uid() = rqt.created_by_account_id)
        )
    )
  );
