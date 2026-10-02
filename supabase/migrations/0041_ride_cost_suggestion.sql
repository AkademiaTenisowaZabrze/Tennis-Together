-- Sugerowany koszt przejazdu (Paweł, 2026-10-02).
--
-- Zasada: aplikacja nie służy do zarabiania, tylko do dzielenia kosztów
-- paliwa. Kierowca podaje kwotę od osoby, zawodnik (rodzic) widzi ją PRZED
-- wysłaniem prośby i wysyłając prośbę się z nią zgadza (albo nie wysyła).
-- Żeby kierowca wiedział, ile to mniej więcej powinno być, aplikacja liczy
-- SUGEROWANĄ kwotę: dystans × spalanie × cena paliwa, podzielone przez
-- liczbę osób w aucie (domyślnie 4 = jedna czwarta kosztu przejazdu).
--
-- Parametry kalkulatora (spalanie, cena paliwa, ...) widzi i zmienia TYLKO
-- administrator (panel admin). Zwykły użytkownik dostaje wyłącznie gotowy
-- wynik z funkcji ride_cost_suggestion().

-- ── Ustawienia kalkulatora (jeden wiersz) ─────────────────────────────────
create table if not exists ride_cost_settings (
  id boolean primary key default true check (id), -- wymusza jeden wiersz
  consumption_l_per_100km numeric(4,1) not null default 6.5 check (consumption_l_per_100km between 3 and 20),
  fuel_price_pln numeric(5,2) not null default 6.50 check (fuel_price_pln between 2 and 15),
  road_factor numeric(3,2) not null default 1.25 check (road_factor between 1 and 2), -- droga jest dłuższa niż linia prosta
  round_trip boolean not null default true,   -- kierowca jedzie tam i z powrotem
  share_divisor int not null default 4 check (share_divisor between 1 and 8),
  round_to_pln int not null default 5 check (round_to_pln between 1 and 50),
  updated_at timestamptz not null default now()
);

insert into ride_cost_settings (id) values (true) on conflict (id) do nothing;

alter table ride_cost_settings enable row level security;

create policy "Administrator czyta ustawienia kalkulatora kosztów"
  on ride_cost_settings for select to authenticated
  using (is_admin());

create policy "Administrator zmienia ustawienia kalkulatora kosztów"
  on ride_cost_settings for update to authenticated
  using (is_admin())
  with check (is_admin());

-- ── Zwrot kosztów: wybór kierowcy + zgoda zawodnika ───────────────────────
-- Kierowca na ofercie zaznacza, czy chce zwrotu kosztów. Jeśli tak, musi
-- potwierdzić, że przyjmuje do wiadomości i zgadza się na kwotę wyliczoną
-- przez kalkulator (parametry ustala administrator). Kwoty NIE wpisuje sam:
-- ustawia ją baza (trigger poniżej), a po utworzeniu oferty jest zamrożona
-- (żeby ją zmienić, trzeba dodać ofertę od nowa).
alter table ride_offers
  add column if not exists cost_refund boolean not null default false,
  add column if not exists cost_terms_accepted boolean not null default false,
  add column if not exists cost_terms_accepted_at timestamptz,
  add column if not exists cost_per_person_pln int
    check (cost_per_person_pln is null or cost_per_person_pln between 0 and 500);

create or replace function set_ride_offer_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.cost_refund := old.cost_refund;
    new.cost_terms_accepted := old.cost_terms_accepted;
    new.cost_terms_accepted_at := old.cost_terms_accepted_at;
    new.cost_per_person_pln := old.cost_per_person_pln;
    return new;
  end if;

  if not new.cost_refund then
    new.cost_terms_accepted := false;
    new.cost_terms_accepted_at := null;
    new.cost_per_person_pln := null;
    return new;
  end if;

  if not new.cost_terms_accepted then
    raise exception 'Aby żądać zwrotu kosztów, potwierdź zgodę na kwotę z kalkulatora.';
  end if;

  -- auth.uid() to właściciel wyjazdu (egzekwuje to RLS), więc kalkulator go wpuści
  select r.per_person_pln into new.cost_per_person_pln
    from ride_cost_suggestion(new.trip_id) r;
  if new.cost_per_person_pln is null then
    raise exception 'Nie można wyliczyć kwoty dla tej trasy (miasto spoza listy). Dodaj ofertę bez zwrotu kosztów.';
  end if;
  new.cost_terms_accepted_at := now();
  return new;
end;
$$;

drop trigger if exists set_ride_offer_cost_trg on ride_offers;
create trigger set_ride_offer_cost_trg
  before insert or update on ride_offers
  for each row execute function set_ride_offer_cost();

-- Kwota, z którą zawodnik się zgodził wysyłając prośbę. Ustawiana w bazie
-- (nie z przeglądarki) i potem zamrożona: późniejsza zmiana kwoty w ofercie
-- nie zmienia warunków już wysłanej prośby.
alter table ride_join_requests
  add column if not exists agreed_cost_pln int;

create or replace function set_agreed_ride_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    select cost_per_person_pln into new.agreed_cost_pln
      from ride_offers where id = new.ride_offer_id;
  else
    new.agreed_cost_pln := old.agreed_cost_pln;
  end if;
  return new;
end;
$$;

drop trigger if exists set_agreed_ride_cost_ins on ride_join_requests;
create trigger set_agreed_ride_cost_ins
  before insert on ride_join_requests
  for each row execute function set_agreed_ride_cost();

drop trigger if exists set_agreed_ride_cost_upd on ride_join_requests;
create trigger set_agreed_ride_cost_upd
  before update on ride_join_requests
  for each row execute function set_agreed_ride_cost();

-- ── Kalkulator: sugerowana kwota od osoby dla wyjazdu ─────────────────────
-- Dostępny dla właściciela wyjazdu i dla każdego, kto ten wyjazd widzi jako
-- ofertę przejazdu. Zwraca tylko wynik (kilometry i kwotę), nie parametry.
create or replace function ride_cost_suggestion(p_trip_id uuid)
returns table (distance_km int, per_person_pln int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s ride_cost_settings;
  t record;
  lat1 double precision;
  lng1 double precision;
  lat2 double precision;
  lng2 double precision;
  km numeric;
  total numeric;
begin
  if auth.uid() is null then
    return;
  end if;

  select * into s from ride_cost_settings where id;
  if not found then
    return;
  end if;

  select tr.departure_city, tr.departure_lat, tr.departure_lng,
         tn.city as t_city, tn.lat as t_lat, tn.lng as t_lng,
         tr.created_by_account_id as owner_id
    into t
    from trips tr
    join tournaments tn on tn.id = tr.tournament_id
   where tr.id = p_trip_id;
  if not found then
    return;
  end if;

  if t.owner_id <> auth.uid()
     and not exists (select 1 from ride_offers where trip_id = p_trip_id) then
    return;
  end if;

  -- Współrzędne: z wyjazdu/turnieju, a gdy ich brak — z listy polskich miast
  -- (porównanie bez polskich znaków i wielkości liter, jak w aplikacji).
  lat1 := t.departure_lat; lng1 := t.departure_lng;
  if lat1 is null or lng1 is null then
    select c.lat, c.lng into lat1, lng1
      from city_coordinates c
     where translate(lower(trim(c.city)), 'ąćęłńóśźż', 'acelnoszz')
         = translate(lower(trim(t.departure_city)), 'ąćęłńóśźż', 'acelnoszz')
     limit 1;
  end if;

  lat2 := t.t_lat; lng2 := t.t_lng;
  if lat2 is null or lng2 is null then
    select c.lat, c.lng into lat2, lng2
      from city_coordinates c
     where translate(lower(trim(c.city)), 'ąćęłńóśźż', 'acelnoszz')
         = translate(lower(trim(t.t_city)), 'ąćęłńóśźż', 'acelnoszz')
     limit 1;
  end if;

  if lat1 is null or lng1 is null or lat2 is null or lng2 is null then
    return;
  end if;

  -- haversine
  km := 2 * 6371 * asin(sqrt(
          power(sin(radians(lat2 - lat1) / 2), 2)
          + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
        )) * s.road_factor;

  total := km * (case when s.round_trip then 2 else 1 end)
           * s.consumption_l_per_100km / 100 * s.fuel_price_pln;

  distance_km := round(km)::int;
  per_person_pln := greatest(
    s.round_to_pln,
    (round(total / s.share_divisor / s.round_to_pln) * s.round_to_pln)::int
  );
  return next;
end;
$$;

revoke all on function ride_cost_suggestion(uuid) from public, anon;
grant execute on function ride_cost_suggestion(uuid) to authenticated;
