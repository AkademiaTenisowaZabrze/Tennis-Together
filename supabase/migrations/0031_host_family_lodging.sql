-- "Nocleg u zawodnika" (Etap 2, LodgingPage.jsx) — rodzina goszczi
-- zawodnika u siebie na czas turnieju. Świadomie ODDZIELNA tabela od
-- `lodging_offers`: tamta wymaga `trip_id` (gospodarz musiałby mieć
-- WŁASNEGO zawodnika jadącego na TEN SAM turniej), a gospodarz może po
-- prostu mieszkać blisko kortów bez własnego dziecka grającego akurat tam.
--
-- Model bezpieczeństwa (ustalony z Pawłem, 2026-09-27):
--   1) Rodzic zawodnika (gościa) musi mieć udzieloną zgodę
--      `consents.consent_type = 'host_family_stay'` dla SWOJEGO zawodnika,
--      ZANIM w ogóle będzie mógł wysłać zgłoszenie do gospodarza — a więc
--      zanim pozna gospodarza/zobaczy jego profil (ten sam wzorzec co przy
--      przejazdach/noclegach: dane drugiej strony ujawnia dopiero
--      zaakceptowane zgłoszenie, patrz match_profile() w 0019_avatars.sql).
--   2) Gospodarz musi AKTYWNIE zaakceptować KONKRETNE zgłoszenie (nie samo
--      wystawienie oferty) — czyli obie strony potwierdzają, zanim czat/
--      profil się odblokuje.
-- Widoczność ofert: dla wszystkich zalogowanych (nie tylko klub) — decyzja
-- Pawła, jak przy Przejazdach/Noclegach.

create table lodging_host_offers (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  host_account_id uuid not null references accounts(id) on delete cascade,
  city text not null,
  capacity int not null default 1 check (capacity > 0),
  notes text,
  created_at timestamptz not null default now(),
  unique (tournament_id, host_account_id)
);

alter table lodging_host_offers enable row level security;

create policy "Zalogowani widzą oferty noclegu u rodziny"
  on lodging_host_offers for select
  to authenticated
  using (true);

create policy "Gospodarz zarządza własną ofertą noclegu u rodziny"
  on lodging_host_offers for all
  to authenticated
  using (host_account_id = auth.uid())
  with check (host_account_id = auth.uid());

drop policy if exists "Zawieszone konto nie ma dostępu" on lodging_host_offers;
create policy "Zawieszone konto nie ma dostępu"
  on lodging_host_offers as restrictive for all to authenticated
  using (account_is_active())
  with check (account_is_active());

-- Zgłoszenie od zawodnika (gościa) do konkretnej oferty gospodarza.
create table lodging_host_requests (
  id uuid primary key default gen_random_uuid(),
  host_offer_id uuid not null references lodging_host_offers(id) on delete cascade,
  requester_trip_id uuid not null references trips(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (host_offer_id, requester_trip_id)
);

alter table lodging_host_requests enable row level security;

create policy "Strony widzą swoje zgłoszenia noclegu u rodziny"
  on lodging_host_requests for select
  to authenticated
  using (
    exists (select 1 from lodging_host_offers o where o.id = host_offer_id and o.host_account_id = auth.uid())
    or exists (select 1 from trips t where t.id = requester_trip_id and t.created_by_account_id = auth.uid())
  );

-- Punkt (1) modelu bezpieczeństwa: bez aktywnej zgody `host_family_stay`
-- dla zawodnika z tego wyjazdu, insert jest odrzucony przez RLS — nie da
-- się wysłać zgłoszenia bez uprzedniej zgody rodzica.
create policy "Zgłaszający wysyła prośbę (wymaga zgody rodzica)"
  on lodging_host_requests for insert
  to authenticated
  with check (
    status = 'pending'
    and exists (
      select 1
      from trips t
      join consents c on c.player_id = t.player_id
      where t.id = requester_trip_id
        and t.created_by_account_id = auth.uid()
        and c.consent_type = 'host_family_stay'
        and c.granted
    )
  );

-- Jedna szeroka polityka UPDATE + trigger niżej pilnujący PRAWDZIWYCH reguł
-- przejść statusu — NIE osobne polityki per rola/przejście. Postgres OR-uje
-- wszystkie pasujące USING i WSZYSTKIE pasujące WITH CHECK osobno, więc dwie
-- osobne polityki "gospodarz robi X" + "proszący robi Y" faktycznie
-- pozwoliłyby też "proszącemu zrobić X" — ten sam błąd i fix co przy
-- ride_pings (0028) i confirm_meeting (0026).
create policy "Strony aktualizują status zgłoszenia noclegu u rodziny"
  on lodging_host_requests for update
  to authenticated
  using (
    exists (select 1 from lodging_host_offers o where o.id = host_offer_id and o.host_account_id = auth.uid())
    or exists (select 1 from trips t where t.id = requester_trip_id and t.created_by_account_id = auth.uid())
  )
  with check (true);

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

drop trigger if exists guard_host_request_transition_trg on lodging_host_requests;
create trigger guard_host_request_transition_trg
  before update on lodging_host_requests
  for each row execute function guard_host_request_transition();

drop policy if exists "Zawieszone konto nie ma dostępu" on lodging_host_requests;
create policy "Zawieszone konto nie ma dostępu"
  on lodging_host_requests as restrictive for all to authenticated
  using (account_is_active())
  with check (account_is_active());

-- match_profile() (0019_avatars.sql) też musi znać to nowe źródło
-- dopasowania — inaczej CounterpartCard (imię/zdjęcie/"Parent Verified")
-- nie pokazałaby się po zaakceptowanym noclegu u rodziny.
create or replace function match_profile(other_account_id uuid)
returns table (full_name text, avatar_url text, verified boolean)
language sql
security definer
set search_path = public
stable
as $$
  select a.full_name, a.avatar_url, a.verified
  from accounts a
  where a.id = other_account_id
    and (
      exists (
        select 1
        from ride_join_requests rjr
        join ride_offers ro on ro.id = rjr.ride_offer_id
        join trips ot on ot.id = ro.trip_id
        join trips rt on rt.id = rjr.requester_trip_id
        where rjr.status = 'accepted'
          and (
            (ot.created_by_account_id = auth.uid() and rt.created_by_account_id = other_account_id)
            or (rt.created_by_account_id = auth.uid() and ot.created_by_account_id = other_account_id)
          )
      )
      or exists (
        select 1
        from lodging_join_requests ljr
        join lodging_offers lo on lo.id = ljr.lodging_offer_id
        join trips ot on ot.id = lo.trip_id
        join trips rt on rt.id = ljr.requester_trip_id
        where ljr.status = 'accepted'
          and (
            (ot.created_by_account_id = auth.uid() and rt.created_by_account_id = other_account_id)
            or (rt.created_by_account_id = auth.uid() and ot.created_by_account_id = other_account_id)
          )
      )
      or exists (
        select 1
        from lodging_host_requests lhr
        join lodging_host_offers lho on lho.id = lhr.host_offer_id
        join trips rt on rt.id = lhr.requester_trip_id
        where lhr.status = 'accepted'
          and (
            (lho.host_account_id = auth.uid() and rt.created_by_account_id = other_account_id)
            or (rt.created_by_account_id = auth.uid() and lho.host_account_id = other_account_id)
          )
      )
    );
$$;

-- Nowy typ zgody — punkt (1) modelu bezpieczeństwa wyżej.
alter table consents drop constraint if exists consents_consent_type_check;
alter table consents add constraint consents_consent_type_check
  check (consent_type in ('terms', 'data_processing', 'contact_sharing', 'host_family_stay'));

-- Rozmowa po zaakceptowaniu — ten sam wzorzec co ride_pings (0028):
-- osobna kolumna zamiast przeciążania ride_offer_id/lodging_offer_id.
alter table conversations add column lodging_host_request_id uuid references lodging_host_requests(id) on delete cascade;

-- Czwarte źródło rozmowy — dopisujemy nowy OR-branch do ISTNIEJĄCEJ
-- polityki (0028_ride_pings.sql) zamiast tworzyć nową, żeby nie powielić
-- tego samego pola "account_id"/"auth.uid()" w dwóch osobnych politykach
-- insert (Postgres i tak by je zOR-ował, ale jedna polityka = jedno miejsce
-- prawdy zamiast dwóch kopii tej samej logiki do synchronizowania).
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
    or exists (
      select 1 from lodging_host_requests lhr
      join lodging_host_offers lho on lho.id = lhr.host_offer_id
      join trips rt on rt.id = lhr.requester_trip_id
      where lhr.status = 'accepted'
        and (
          (account_id = lho.host_account_id and auth.uid() = rt.created_by_account_id)
          or (account_id = rt.created_by_account_id and auth.uid() = lho.host_account_id)
        )
    )
  );
