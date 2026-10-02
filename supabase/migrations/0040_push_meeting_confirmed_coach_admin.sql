-- Ostatnie trzy powiadomienia push z listy (Paweł, 2026-10-02):
--  6) spotkanie potwierdzone kodem -> druga strona dostaje zachętę do oceny,
--  7) trener: nowy wyjazd zawodnika z klubu + tygodniowe "komu brakuje
--     transportu" (dołączone do przypomnień z 0039),
--  8) administrator: nowe zgłoszenie błędu / nadużycia.

-- ── Wspólny "licznik odstępów" ────────────────────────────────────────────
-- Zgłoszenia błędów może wysłać każdy (formularz na stronie testerów, bez
-- logowania), więc bez ograniczenia ktoś mógłby zasypać administratora
-- powiadomieniami. claim_push_slot(klucz, minuty) zwraca true tylko jeśli od
-- ostatniego "zajęcia" tego klucza minęło dość czasu — i od razu je zajmuje.
create table if not exists push_throttle (
  key text primary key,
  last_sent_at timestamptz not null
);
alter table push_throttle enable row level security; -- bez polityk: tylko service_role

create or replace function claim_push_slot(p_key text, p_minutes int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into push_throttle (key, last_sent_at) values (p_key, now())
  on conflict (key) do update set last_sent_at = now()
    where push_throttle.last_sent_at < now() - make_interval(mins => p_minutes);
  return found;
end;
$$;

revoke all on function claim_push_slot(text, int) from public, anon, authenticated;
grant execute on function claim_push_slot(text, int) to service_role;

-- ── 6) Spotkanie potwierdzone ─────────────────────────────────────────────
alter table ride_join_requests add column if not exists confirmed_push_sent_at timestamptz;
alter table lodging_join_requests add column if not exists confirmed_push_sent_at timestamptz;
alter table lodging_host_requests add column if not exists confirmed_push_sent_at timestamptz;

update ride_join_requests set confirmed_push_sent_at = now()
 where meeting_confirmed_at is not null and confirmed_push_sent_at is null;
update lodging_join_requests set confirmed_push_sent_at = now()
 where meeting_confirmed_at is not null and confirmed_push_sent_at is null;
update lodging_host_requests set confirmed_push_sent_at = now()
 where meeting_confirmed_at is not null and confirmed_push_sent_at is null;

create or replace function notify_meeting_confirmed()
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
      'event', 'meeting_confirmed',
      'request_kind', TG_ARGV[0],
      'request_id', new.id
    )
  );
  return new;
end;
$$;

drop trigger if exists on_ride_meeting_confirmed on ride_join_requests;
create trigger on_ride_meeting_confirmed
  after update of meeting_confirmed_at on ride_join_requests
  for each row
  when (old.meeting_confirmed_at is null and new.meeting_confirmed_at is not null)
  execute function notify_meeting_confirmed('ride');

drop trigger if exists on_lodging_meeting_confirmed on lodging_join_requests;
create trigger on_lodging_meeting_confirmed
  after update of meeting_confirmed_at on lodging_join_requests
  for each row
  when (old.meeting_confirmed_at is null and new.meeting_confirmed_at is not null)
  execute function notify_meeting_confirmed('lodging');

drop trigger if exists on_host_meeting_confirmed on lodging_host_requests;
create trigger on_host_meeting_confirmed
  after update of meeting_confirmed_at on lodging_host_requests
  for each row
  when (old.meeting_confirmed_at is null and new.meeting_confirmed_at is not null)
  execute function notify_meeting_confirmed('host_lodging');

-- ── 7) Trener ─────────────────────────────────────────────────────────────
-- Nowy wyjazd zawodnika z klubu -> push do trenera tego klubu.
create or replace function notify_club_trip_created()
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
    body := jsonb_build_object('event', 'club_trip_created', 'trip_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists on_club_trip_created on trips;
create trigger on_club_trip_created
  after insert on trips
  for each row execute function notify_club_trip_created();

-- Tygodniowe podsumowanie dla trenera: ile osób z klubu nie ma jeszcze
-- transportu na turniej startujący za 7 dni. Raz na trenera i turniej.
-- Wołana z Edge Function razem z przypomnieniami (days=7), tylko service_role.
create or replace function claim_coach_digests()
returns table (coach_account_id uuid, tournament_name text, missing_ride int)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select a.id as coach_id, tn.id as tid, tn.name as tname, count(*)::int as missing
      from accounts a
      join players p on lower(trim(p.club_name)) = lower(trim(a.club_name))
      join trips t on t.player_id = p.id
      join tournaments tn on tn.id = t.tournament_id
     where a.role = 'coach'
       and a.club_name is not null
       and p.club_name is not null
       and tn.starts_on = current_date + 7
       and t.status <> 'completed'
       and trip_ride_status(t.id) in ('none', 'pending')
     group by a.id, tn.id, tn.name
  loop
    if claim_push_slot('coach_digest_' || r.coach_id || '_' || r.tid, 60 * 24 * 30) then
      coach_account_id := r.coach_id;
      tournament_name := r.tname;
      missing_ride := r.missing;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function claim_coach_digests() from public, anon, authenticated;
grant execute on function claim_coach_digests() to service_role;

-- ── 8) Administrator ──────────────────────────────────────────────────────
create or replace function notify_admin_report()
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
    body := jsonb_build_object('event', 'admin_report', 'source', TG_ARGV[0])
  );
  return new;
end;
$$;

drop trigger if exists on_bug_report_notify on bug_reports;
create trigger on_bug_report_notify
  after insert on bug_reports
  for each row execute function notify_admin_report('bug');

drop trigger if exists on_abuse_report_notify on reports;
create trigger on_abuse_report_notify
  after insert on reports
  for each row execute function notify_admin_report('abuse');
