-- Dwie nowe tabele z 0028 dopisane do "wyłącznika" zawieszonego konta
-- (0016_account_suspension.sql) — bez tego zawieszone konto mogłoby dalej
-- wysyłać/odbierać zapytania o podwiezienie. `tournament_entries` (0027)
-- świadomie NIE jest tu dopisane — to publiczny rejestr PZT, ten sam
-- wyjątek co `tournaments`/`city_coordinates`.

drop policy if exists "Zawieszone konto nie ma dostępu" on ride_pings;
create policy "Zawieszone konto nie ma dostępu"
  on ride_pings as restrictive for all to authenticated
  using (account_is_active())
  with check (account_is_active());
