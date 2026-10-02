-- Powiadomienie push "Twoja prośba została zaakceptowana" (Paweł, 2026-10-02).
-- Dotąd druga strona dowiadywała się o akceptacji dopiero po wejściu do
-- aplikacji. Ta sama architektura co 0020: trigger bazy -> pg_net -> Edge
-- Function notify-tournament (teraz z drugim trybem "request_accepted").
--
-- Kolumna push_sent_at działa jak jednorazowy bilet: funkcja ustawia ją
-- atomowo (update ... where push_sent_at is null), więc ani podwójne
-- wywołanie, ani ręczne wołanie funkcji publicznym kluczem nie wyśle
-- drugiego powiadomienia o tej samej akceptacji. Istniejące, już
-- zaakceptowane wiersze oznaczamy jako "wysłane", żeby nikt nie mógł
-- wywołać zaległych powiadomień o starych akceptacjach.

alter table ride_join_requests add column if not exists push_sent_at timestamptz;
alter table lodging_join_requests add column if not exists push_sent_at timestamptz;
alter table ride_pings add column if not exists push_sent_at timestamptz;
alter table lodging_host_requests add column if not exists push_sent_at timestamptz;

update ride_join_requests set push_sent_at = now() where status = 'accepted' and push_sent_at is null;
update lodging_join_requests set push_sent_at = now() where status = 'accepted' and push_sent_at is null;
update ride_pings set push_sent_at = now() where status = 'accepted' and push_sent_at is null;
update lodging_host_requests set push_sent_at = now() where status = 'accepted' and push_sent_at is null;

create or replace function notify_request_accepted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://jrabxtiranllayerhutm.supabase.co/functions/v1/notify-tournament',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_8-yxyMhoEEq-kHx2opU0Pg_QylogBur'
    ),
    body := jsonb_build_object(
      'event', 'request_accepted',
      'request_kind', TG_ARGV[0],
      'request_id', new.id
    )
  );
  return new;
end;
$$;

drop trigger if exists on_ride_request_accepted on ride_join_requests;
create trigger on_ride_request_accepted
  after update of status on ride_join_requests
  for each row
  when (old.status is distinct from new.status and new.status = 'accepted')
  execute function notify_request_accepted('ride');

drop trigger if exists on_lodging_request_accepted on lodging_join_requests;
create trigger on_lodging_request_accepted
  after update of status on lodging_join_requests
  for each row
  when (old.status is distinct from new.status and new.status = 'accepted')
  execute function notify_request_accepted('lodging');

drop trigger if exists on_ride_ping_accepted on ride_pings;
create trigger on_ride_ping_accepted
  after update of status on ride_pings
  for each row
  when (old.status is distinct from new.status and new.status = 'accepted')
  execute function notify_request_accepted('ride_ping');

drop trigger if exists on_host_request_accepted on lodging_host_requests;
create trigger on_host_request_accepted
  after update of status on lodging_host_requests
  for each row
  when (old.status is distinct from new.status and new.status = 'accepted')
  execute function notify_request_accepted('host_lodging');
