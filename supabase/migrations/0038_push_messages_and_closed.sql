-- Dwa kolejne powiadomienia push (Paweł, 2026-10-02):
--  1) nowa wiadomość na czacie (bez treści) dla pozostałych uczestników,
--  2) prośba odrzucona / druga strona zrezygnowała (przejazd, nocleg,
--     podwiezienie, nocleg u rodziny) dla strony, która tego nie zrobiła.
-- Architektura jak w 0020/0033: trigger -> pg_net -> Edge Function
-- notify-tournament (nowe tryby new_message i request_closed).

-- ── 1) Nowa wiadomość ─────────────────────────────────────────────────────

-- Odstęp między powiadomieniami dla jednego uczestnika rozmowy (funkcja
-- pilnuje 2 minut), żeby żywa rozmowa nie zasypywała telefonu.
alter table conversation_participants add column if not exists last_push_at timestamptz;

create or replace function notify_new_message()
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
    body := jsonb_build_object('event', 'new_message', 'message_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists on_message_notify on messages;
create trigger on_message_notify
  after insert on messages
  for each row execute function notify_new_message();

-- ── 2) Odrzucona prośba / rezygnacja ──────────────────────────────────────

alter table ride_join_requests add column if not exists closed_push_sent_at timestamptz;
alter table lodging_join_requests add column if not exists closed_push_sent_at timestamptz;
alter table ride_pings add column if not exists closed_push_sent_at timestamptz;
alter table lodging_host_requests add column if not exists closed_push_sent_at timestamptz;

-- Istniejące zamknięte prośby oznaczamy jako "wysłane" (jak w 0033/0034).
update ride_join_requests set closed_push_sent_at = now()
 where status in ('declined', 'cancelled') and closed_push_sent_at is null;
update lodging_join_requests set closed_push_sent_at = now()
 where status in ('declined', 'cancelled') and closed_push_sent_at is null;
update ride_pings set closed_push_sent_at = now()
 where status in ('declined', 'cancelled') and closed_push_sent_at is null;
update lodging_host_requests set closed_push_sent_at = now()
 where status in ('declined', 'cancelled') and closed_push_sent_at is null;

-- actor_id = auth.uid() w chwili zmiany: status "anulowano" nie mówi, KTÓRA
-- strona zrezygnowała, a powiadomić trzeba tę drugą. Wygaszanie systemowe
-- (0034) nie ma aktora (auth.uid() = null), więc funkcja nikogo nie powiadomi.
create or replace function notify_request_closed()
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
      'event', 'request_closed',
      'request_kind', TG_ARGV[0],
      'request_id', new.id,
      'actor_id', auth.uid()
    )
  );
  return new;
end;
$$;

drop trigger if exists on_ride_request_closed on ride_join_requests;
create trigger on_ride_request_closed
  after update of status on ride_join_requests
  for each row
  when (old.status is distinct from new.status and new.status in ('declined', 'cancelled'))
  execute function notify_request_closed('ride');

drop trigger if exists on_lodging_request_closed on lodging_join_requests;
create trigger on_lodging_request_closed
  after update of status on lodging_join_requests
  for each row
  when (old.status is distinct from new.status and new.status in ('declined', 'cancelled'))
  execute function notify_request_closed('lodging');

drop trigger if exists on_ride_ping_closed on ride_pings;
create trigger on_ride_ping_closed
  after update of status on ride_pings
  for each row
  when (old.status is distinct from new.status and new.status in ('declined', 'cancelled'))
  execute function notify_request_closed('ride_ping');

drop trigger if exists on_host_request_closed on lodging_host_requests;
create trigger on_host_request_closed
  after update of status on lodging_host_requests
  for each row
  when (old.status is distinct from new.status and new.status in ('declined', 'cancelled'))
  execute function notify_request_closed('host_lodging');
