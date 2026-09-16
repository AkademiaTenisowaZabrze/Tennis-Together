-- Domknięcie dziury bezpieczeństwa z głębokiego audytu (Paweł, 2026-09-16):
-- `consents`, `trip_groups` i `trip_group_members` zostały utworzone w
-- 0001_init.sql BEZ włączonego RLS i nikt nigdy tego nie dołożył — dokładnie
-- ten sam błąd co wcześniej znaleziony i naprawiony dla `reports`/`blocks`
-- (patrz 0021_admin_panel.sql). Bez tego każdy zalogowany użytkownik mógł
-- odczytać/nadpisać CUDZE zgody rodzicielskie (RODO, dane małoletnich) i
-- grupy wyjazdowe wprost przez REST API, z pominięciem UI.
--
-- `consents` i `trip_group_members`/`trip_groups` nie są jeszcze podłączone
-- pod żaden ekran w apce (patrz PLAN.md, "Następne kroki") — polityki niżej
-- są więc celowo minimalne (właściciel/twórca), a nie pełnym docelowym
-- modelem współdzielenia w grupie — do rozszerzenia, kiedy te funkcje
-- faktycznie powstaną w UI.

alter table consents enable row level security;

-- Zgoda jest tworzona i czytana wyłącznie przez rodzica/opiekuna, który jej
-- udzielił — nigdy nie edytowana (nowa zgoda = nowy wiersz, patrz komentarz
-- przy tabeli w 0001_init.sql), więc świadomie brak polityki update/delete.
create policy "Właściciel widzi własne zgody"
  on consents for select to authenticated
  using (given_by_account_id = auth.uid());

create policy "Właściciel dodaje własne zgody"
  on consents for insert to authenticated
  with check (given_by_account_id = auth.uid());

alter table trip_groups enable row level security;

create policy "Twórca zarządza własną grupą wyjazdową"
  on trip_groups for all to authenticated
  using (created_by_account_id = auth.uid())
  with check (created_by_account_id = auth.uid());

alter table trip_group_members enable row level security;

-- Dwustronna, ale bezpieczna kontrola (bez rekursji) — subquery idzie
-- wyłącznie W JEDNĄ stronę (trip_group_members → trip_groups / trips),
-- a żadna istniejąca polityka na `trips` ani `trip_groups` nie odpytuje z
-- powrotem `trip_group_members`, więc cyklu nie ma (patrz
-- feedback_supabase_rls_recursion w pamięci projektu).
create policy "Twórca grupy zarządza jej członkami"
  on trip_group_members for all to authenticated
  using (
    exists (select 1 from trip_groups g where g.id = trip_group_id and g.created_by_account_id = auth.uid())
  )
  with check (
    exists (select 1 from trip_groups g where g.id = trip_group_id and g.created_by_account_id = auth.uid())
  );

create policy "Właściciel wyjazdu widzi swoje członkostwo w grupie"
  on trip_group_members for select to authenticated
  using (
    exists (select 1 from trips t where t.id = trip_id and t.created_by_account_id = auth.uid())
  );

-- Dodatkowo: `device_tokens` (dodane w 0020, już po tym jak lista tabel w
-- zawieszeniu konta powstała w 0016) nie było objęte kill-switchem —
-- zawieszone konto mogło nadal rejestrować/odświeżać token i dostawać
-- powiadomienia push mimo zawieszenia. Ten sam wzorzec RESTRICTIVE co 0016.
drop policy if exists "Zawieszone konto nie ma dostępu" on device_tokens;
create policy "Zawieszone konto nie ma dostępu"
  on device_tokens as restrictive for all to authenticated
  using (account_is_active())
  with check (account_is_active());
