-- Limity długości pól tekstowych (F23) i retencja danych (F21), audyt bezpieczeństwa 2026-10-03.
--
-- F23 Pola tekstowe wpisywane przez użytkowników nie miały ograniczeń długości, więc jedno konto mogło
--     zapełnić bazę (wiadomości, notatki, zgłoszenia). Ograniczenia są dodane jako NOT VALID: dotyczą
--     nowych i zmienianych wierszy, a istniejących danych nie ruszają ani nie blokują.
-- F21 Dane osobowe nie miały żadnego okresu przechowywania. purge_old_data() usuwa dane po terminie
--     (okresy w tabeli niżej); wywołuje ją raz w tygodniu workflow retention.yml kluczem service_role.
--
--   wiadomości                         12 miesięcy od wysłania
--   prośby/zapytania zakończone         12 miesięcy od utworzenia (odrzucone/anulowane) lub po 12 mies. od turnieju
--   zgłoszenia błędów rozwiązane         6 miesięcy
--   zgłoszenia nadużyć rozwiązane       12 miesięcy
--   próby rejestracji                    2 dni (do licznika wystarcza godzina)
--   przepustnica powiadomień            30 dni

alter table messages add constraint messages_body_length check (char_length(body) between 1 and 2000) not valid;
alter table reports add constraint reports_reason_length check (char_length(reason) between 1 and 2000) not valid;
alter table trips add constraint trips_notes_length check (char_length(notes) <= 500) not valid;
alter table ride_offers add constraint ride_offers_text_length
  check (char_length(luggage_space) <= 300 and char_length(driver_notes) <= 1000) not valid;
alter table ride_requests add constraint ride_requests_notes_length check (char_length(notes) <= 1000) not valid;
alter table lodging_offers add constraint lodging_offers_text_length
  check (char_length(place_name) <= 200 and char_length(notes) <= 1000) not valid;
alter table accounts add constraint accounts_text_length
  check (char_length(full_name) between 1 and 120
         and char_length(city) <= 120 and char_length(club_name) <= 120 and char_length(phone) <= 30) not valid;
alter table players add constraint players_text_length
  check (char_length(first_name) between 1 and 80 and char_length(last_name) between 1 and 80
         and char_length(city) <= 120 and char_length(club_name) <= 120 and char_length(pzt_login) <= 20) not valid;

create or replace function purge_old_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_msg int;
  n_rjr int;
  n_ljr int;
  n_ping int;
  n_host int;
  n_bug int;
  n_rep int;
  n_sign int;
  n_thr int;
begin
  perform set_config('tt.meeting_rpc', 'on', true);
  perform set_config('tt.expire_rpc', 'on', true);

  delete from messages where created_at < now() - interval '12 months';
  get diagnostics n_msg = row_count;

  -- prośby i zapytania po turnieju, który zakończył się ponad 12 miesięcy temu, oraz stare nieudane
  delete from ride_join_requests r using trips t join tournaments tn on tn.id = t.tournament_id
   where r.requester_trip_id = t.id and coalesce(tn.ends_on, tn.starts_on) < current_date - interval '12 months';
  get diagnostics n_rjr = row_count;
  delete from lodging_join_requests r using trips t join tournaments tn on tn.id = t.tournament_id
   where r.requester_trip_id = t.id and coalesce(tn.ends_on, tn.starts_on) < current_date - interval '12 months';
  get diagnostics n_ljr = row_count;
  delete from ride_pings p using tournaments tn
   where tn.id = p.tournament_id and coalesce(tn.ends_on, tn.starts_on) < current_date - interval '12 months';
  get diagnostics n_ping = row_count;
  delete from lodging_host_requests r using trips t join tournaments tn on tn.id = t.tournament_id
   where r.requester_trip_id = t.id and coalesce(tn.ends_on, tn.starts_on) < current_date - interval '12 months';
  get diagnostics n_host = row_count;

  delete from bug_reports where resolved and created_at < now() - interval '6 months';
  get diagnostics n_bug = row_count;
  delete from reports where status = 'resolved' and created_at < now() - interval '12 months';
  get diagnostics n_rep = row_count;
  delete from signup_attempts where created_at < now() - interval '2 days';
  get diagnostics n_sign = row_count;
  delete from push_throttle where last_sent_at < now() - interval '30 days';
  get diagnostics n_thr = row_count;

  return jsonb_build_object(
    'messages', n_msg, 'ride_join_requests', n_rjr, 'lodging_join_requests', n_ljr, 'ride_pings', n_ping,
    'lodging_host_requests', n_host, 'bug_reports', n_bug, 'reports', n_rep, 'signup_attempts', n_sign, 'push_throttle', n_thr
  );
end;
$$;

revoke all on function purge_old_data() from public, anon, authenticated;
grant execute on function purge_old_data() to service_role;
