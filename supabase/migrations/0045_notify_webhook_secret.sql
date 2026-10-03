-- Wspólny sekret wywołań funkcji brzegowej notify-tournament (audyt bezpieczeństwa 2026-10-03, F5).
--
-- Do tej pory triggery bazy wywoływały funkcję z samym kluczem publicznym (publishable), a ten jest
-- w kodzie aplikacji i widoczny dla każdego. Ktoś z kluczem mógł więc uruchamiać zdarzenia
-- (np. selection_published dla publicznie znanego id turnieju) i spamować użytkowników powiadomieniami.
--
-- Teraz triggery dokładają nagłówek x-webhook-secret z wartością trzymaną w tabeli private_config
-- (poza repozytorium; wpisujesz ją raz w SQL Editorze, patrz niżej), a funkcja brzegowa odrzuca
-- żądania bez sekretu, gdy ma ustawiony NOTIFY_WEBHOOK_SECRET. Dopóki sekretu nie ustawisz, nagłówek
-- nie jest dodawany i wszystko działa jak dotąd.
--
-- Konfiguracja (jednorazowo, wartość wymyśl sam, np. 40 losowych znaków):
--   1) SQL Editor:  insert into private_config(key, value) values ('notify_webhook_secret', '<SEKRET>')
--                   on conflict (key) do update set value = excluded.value;
--   2) Terminal:    supabase secrets set NOTIFY_WEBHOOK_SECRET=<SEKRET>
--   3) GitHub:      Settings > Secrets and variables > Actions > NOTIFY_WEBHOOK_SECRET = <SEKRET>
--   4) Wdrożenie:   supabase functions deploy notify-tournament
-- Kolejność ma znaczenie: funkcja zaczyna wymagać sekretu po kroku 2, więc 1 i 3 zrób wcześniej.

create table if not exists private_config (
  key text primary key,
  value text not null
);
alter table private_config enable row level security;  -- brak polityk = brak dostępu przez API
revoke all on private_config from public, anon, authenticated;

create or replace function notify_edge_headers()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
           'Content-Type', 'application/json',
           'Authorization', 'Bearer sb_publishable_8-yxyMhoEEq-kHx2opU0Pg_QylogBur'
         )
         || coalesce(
              (select jsonb_build_object('x-webhook-secret', value) from private_config where key = 'notify_webhook_secret'),
              '{}'::jsonb
            );
$$;

revoke all on function notify_edge_headers() from public, anon, authenticated;
grant execute on function notify_edge_headers() to service_role;

-- Wszystkie funkcje, które wołają notify-tournament, przechodzą na wspólne nagłówki.
-- (Przepisujemy ich definicje, żeby nie powielać dziewięciu ciał funkcji z migracji 0020-0040.)
do $$
declare
  r record;
  def text;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosrc like '%functions/v1/notify-tournament%'
       and p.prosrc like '%headers := jsonb_build_object(%'
  loop
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, 'headers := jsonb_build_object\([^)]*\)', 'headers := notify_edge_headers()', 'g');
    execute def;
  end loop;
end $$;
