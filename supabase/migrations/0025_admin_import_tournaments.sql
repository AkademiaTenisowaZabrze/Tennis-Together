-- Import turniejów ITF z panelu admina (docs/admin.html, sekcja "Turnieje").
-- Kalendarz ITF chroni system antybotowy, więc nie da się go pobierać
-- automatem (patrz PLAN.md). Administrator sam wkleja listę skopiowaną ze
-- strony w swojej przeglądarce, a panel zapisuje ją do tabeli `tournaments`.
--
-- Do tej pory zapis do `tournaments` był możliwy tylko przez service_role
-- (import z GitHub Actions). Te dwie polityki dają zapis wyłącznie
-- administratorowi i wyłącznie dla wpisów ręcznych/ITF, więc nikt nie może
-- nadpisać turniejów z importu OTK ani Tennis Europe. `is_admin()` jest
-- funkcją SECURITY DEFINER (0021), więc nie ma ryzyka rekursji RLS.

drop policy if exists "Admin dodaje turnieje ITF i ręczne" on tournaments;
create policy "Admin dodaje turnieje ITF i ręczne"
  on tournaments for insert to authenticated
  with check (is_admin() and source in ('itf', 'manual'));

drop policy if exists "Admin poprawia turnieje ITF i ręczne" on tournaments;
create policy "Admin poprawia turnieje ITF i ręczne"
  on tournaments for update to authenticated
  using (is_admin() and source in ('itf', 'manual'))
  with check (is_admin() and source in ('itf', 'manual'));
