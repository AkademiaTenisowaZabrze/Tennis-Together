-- Strażnik kolumn uprzywilejowanych w `accounts` (audyt bezpieczeństwa 2026-10-03, luki F1 i F2).
--
-- Problem: polityka właściciela z 0002 (`for all using (id = auth.uid())`) pozwala zalogowanemu
-- użytkownikowi zapisać DOWOLNĄ kolumnę własnego wiersza, więc przez zwykłe API (klucz publiczny
-- + własny token) mógł:
--   * nadać sobie `is_admin` (pełny dostęp do panelu, kont, zgłoszeń),
--   * nadać sobie `verified` (odznaka "Parent Verified"),
--   * zdjąć zawieszenie (`status` = 'active'),
--   * zostać trenerem (`role` = 'coach'): trener widzi zawodników całego klubu (0011/0012).
--
-- Rozwiązanie: trigger BEFORE INSERT OR UPDATE. Dla zwykłego użytkownika (auth.uid() nie jest
-- puste i nie jest administratorem) kolumny uprzywilejowane są wymuszane/zamrażane po cichu, tak
-- jak w 0041 (set_ride_offer_cost): aplikacja, która omyłkowo wyśle cały wiersz, niczego nie zepsuje.
-- Bez ograniczeń zostają: administrator (panel admina) oraz kontekst bez użytkownika (SQL Editor,
-- service_role, migracje), bo tam auth.uid() jest puste.
--
-- Rola trenera wymaga zatwierdzenia: prośba (rejestracja jako "Trener / klub" albo zmiana roli)
-- kończy się rolą dotychczasową (przy rejestracji: 'parent') i `coach_requested = true`.
-- Administrator zatwierdza w panelu ustawiając `role = 'coach'` (przycisk "Zatwierdź trenera").

alter table accounts
  add column if not exists coach_requested boolean not null default false;

create or replace function guard_account_privileges()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.is_admin := false;
    new.verified := false;
    new.verified_at := null;
    new.status := 'active';
    if new.role = 'coach' then
      new.role := 'parent';
      new.coach_requested := true;
    else
      new.coach_requested := false;
    end if;
  else
    new.is_admin := old.is_admin;
    new.verified := old.verified;
    new.verified_at := old.verified_at;
    new.status := old.status;
    if new.role = 'coach' and old.role <> 'coach' then
      new.role := old.role;
      new.coach_requested := true;
    else
      new.coach_requested := old.coach_requested;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_account_privileges on accounts;
create trigger guard_account_privileges
  before insert or update on accounts
  for each row execute function guard_account_privileges();
