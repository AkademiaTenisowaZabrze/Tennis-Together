-- Cena paliwa w kalkulatorze kosztów (0041) może się teraz aktualizować sama,
-- raz w tygodniu, z oficjalnego Biuletynu Paliwowego Komisji Europejskiej
-- (scripts/update_fuel_price.py + .github/workflows/update-fuel-price.yml).
-- Administrator może to wyłączyć i wpisywać cenę ręcznie albo wybrać rodzaj
-- paliwa (benzyna 95 / diesel / LPG), z którego liczymy koszt.
alter table ride_cost_settings
  add column if not exists fuel_price_auto boolean not null default true,
  add column if not exists fuel_type text not null default 'pb95'
    check (fuel_type in ('pb95', 'diesel', 'lpg')),
  add column if not exists fuel_price_source text,
  add column if not exists fuel_price_updated_at timestamptz not null default now();

update ride_cost_settings
   set fuel_price_source = coalesce(fuel_price_source, 'wartość początkowa')
 where id;
