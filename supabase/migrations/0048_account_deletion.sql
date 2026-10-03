-- Usuwanie konta i danych (RODO art. 17; audyt bezpieczeństwa 2026-10-03, luka F3).
--
-- Dotąd nie dało się usunąć konta: 14 kluczy obcych do `accounts` miało domyślne NO ACTION (zgody,
-- wiadomości, zgłoszenia, wyjazdy, grupy, znaczniki spotkań), więc `delete from auth.users` kończyło się
-- błędem, a aplikacja nie miała zresztą takiej funkcji.
--
-- 1) Klucze obce: dane należące do konta znikają razem z nim (ON DELETE CASCADE); znaczniki "kto ustawił
--    pineskę / kod / potwierdził spotkanie" w cudzych wierszach są tylko zerowane (ON DELETE SET NULL),
--    żeby nie kasować drugiej stronie jej wpisów.
-- 2) delete_my_account(): zalogowany usuwa własne konto jednym wywołaniem (dane z auth.users wraz z
--    kaskadami). Strażniki kolumn spotkań (0026) pomijamy flagą tt.meeting_rpc na czas tej transakcji,
--    bo zerowanie znaczników to operacja systemowa, nie próba obejścia kodu.
--    Plik zdjęcia profilowego (Storage) aplikacja usuwa przed wywołaniem; SQL nie usuwa plików ze Storage.

do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass::text as tbl,
           c.conname,
           a.attname as col,
           pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f'
       and c.confrelid = 'public.accounts'::regclass
       and c.confdeltype = 'a'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format(
      'alter table %s add constraint %I %s on delete %s',
      r.tbl,
      r.conname,
      r.def,
      case when r.col like 'meeting\_%' escape '\' then 'set null' else 'cascade' end
    );
  end loop;
end $$;

create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Wymagane zalogowanie.' using errcode = '42501';
  end if;

  perform set_config('tt.meeting_rpc', 'on', true);
  perform set_config('tt.expire_rpc', 'on', true);

  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;
