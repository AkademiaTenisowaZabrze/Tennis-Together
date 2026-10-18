// TRYB DEMO (vite build --mode demo): aplikacja bez połączenia z prawdziwą bazą.
// Zamiast klienta Supabase działa atrapa z testów, z wymyślonym użytkownikiem ("Test Rodzic")
// i przykładowymi danymi, od razu zalogowanym. Służy do oglądania i testowania wyglądu
// (emulator, przeglądarka) bez zakładania kont na produkcji. Patrz vite.config.js.
import { supabase as fakeSupabase, fake, reset } from "../../tests/helpers/fakeSupabase.js";

reset();

// Daty w atrapie są stałe (2099), a w demo mają być "świeże": przesuwamy je względem dzisiaj,
// żeby odliczanie ("Za 4 dni") i listy wyglądały realistycznie.
const DAY = 86400000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const OFFSETS = { "t-1": [4, 7], "t-2": [18, 21], "t-3": [25, 28] };
for (const t of fake.db.tournaments) {
  const o = OFFSETS[t.id];
  if (o) {
    t.starts_on = iso(o[0]);
    t.ends_on = iso(o[1]);
  }
}
for (const trip of fake.db.trips) {
  const t = fake.db.tournaments.find((x) => x.id === trip.tournament_id);
  if (t) {
    trip.departure_date = iso(Math.round((new Date(t.starts_on) - Date.now()) / DAY) - 1);
    trip.return_date = t.ends_on;
  }
}

// Przykładowy stan załatwienia wyjazdu: transport ustalony, nocleg jeszcze nie.
fake.rpcHandlers.trip_arrangements = () => ({
  data: [{ trip_id: "trip-me-1", ride_status: "arranged", lodging_status: "none" }],
  error: null,
});

export const supabase = fakeSupabase;
export const DEMO_MODE = true;
