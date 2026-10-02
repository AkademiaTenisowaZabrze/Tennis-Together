-- Push "ustalono miejsce spotkania" (Paweł, 2026-10-02): gdy jedna strona
-- ustawi/zmieni pineskę z 0036, druga dostaje powiadomienie. Funkcja
-- notify-tournament (zdarzenie meeting_point_set) pilnuje, żeby nie częściej
-- niż raz na 5 minut na prośbę (kolumna meeting_point_push_at) — przesuwanie
-- pineski kilka razy pod rząd nie spamuje drugiej strony.

alter table ride_join_requests add column if not exists meeting_point_push_at timestamptz;
alter table ride_pings add column if not exists meeting_point_push_at timestamptz;

create or replace function notify_meeting_point()
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
      'event', 'meeting_point_set',
      'request_kind', TG_ARGV[0],
      'request_id', new.id
    )
  );
  return new;
end;
$$;

drop trigger if exists on_ride_meeting_point on ride_join_requests;
create trigger on_ride_meeting_point
  after update of meeting_lat, meeting_lng on ride_join_requests
  for each row
  when (new.meeting_lat is not null
        and (old.meeting_lat is distinct from new.meeting_lat or old.meeting_lng is distinct from new.meeting_lng))
  execute function notify_meeting_point('ride');

drop trigger if exists on_ride_ping_meeting_point on ride_pings;
create trigger on_ride_ping_meeting_point
  after update of meeting_lat, meeting_lng on ride_pings
  for each row
  when (new.meeting_lat is not null
        and (old.meeting_lat is distinct from new.meeting_lat or old.meeting_lng is distinct from new.meeting_lng))
  execute function notify_meeting_point('ride_ping');
