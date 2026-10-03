-- Utwardzenie funkcji (audyt bezpieczeństwa 2026-10-03, F13 i F14).
--
-- F13 Dwie funkcje triggerów (guard_meeting_columns, guard_ride_ping_transition) nie miały ustawionego
--     search_path, więc ich nazwy niekwalifikowane zależały od ścieżki wyszukiwania sesji. Ustawiamy `public`.
-- F14 Funkcje pomocnicze polityk RLS (trip_has_public_offer, trip_is_requester_for_my_offer, player_visible_to_my_coach,
--     is_conversation_participant, can_rate, account_is_active, is_admin) były wykonywalne przez anonima (domyślny
--     EXECUTE dla PUBLIC), więc kto miał klucz publiczny, mógł je wołać jako RPC (np. sprawdzać, czy dany wyjazd
--     ma ofertę). Polityki, które z nich korzystają, są `TO authenticated`, więc anonim ich nie potrzebuje.

alter function guard_meeting_columns() set search_path = public;
alter function guard_ride_ping_transition() set search_path = public;

revoke execute on function
  trip_has_public_offer(uuid),
  trip_is_requester_for_my_offer(uuid),
  player_visible_to_my_coach(uuid),
  is_conversation_participant(uuid),
  can_rate(uuid, text, uuid),
  account_is_active(),
  is_admin()
from public, anon;

grant execute on function
  trip_has_public_offer(uuid),
  trip_is_requester_for_my_offer(uuid),
  player_visible_to_my_coach(uuid),
  is_conversation_participant(uuid),
  can_rate(uuid, text, uuid),
  account_is_active(),
  is_admin()
to authenticated, service_role;
