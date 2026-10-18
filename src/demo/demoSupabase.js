// TRYB DEMO (vite build --mode demo): aplikacja bez połączenia z prawdziwą bazą.
// Zamiast klienta Supabase działa atrapa z testów, z wymyślonym użytkownikiem ("Test Rodzic")
// i przykładowymi danymi, od razu zalogowanym. Służy do oglądania i testowania wyglądu
// (emulator, przeglądarka) bez zakładania kont na produkcji. Patrz vite.config.js.
import { supabase as fakeSupabase, fake, reset, ME, OTHER } from "../../tests/helpers/fakeSupabase.js";

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

// Przykładowa rozmowa (z gotowymi wiadomościami), żeby można było obejrzeć listę rozmów i okno czatu.
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
fake.db.conversations = [
  {
    id: "conv-demo-1",
    kind: "ride",
    created_at: hoursAgo(5),
    ride_offers: { trips: { departure_city: "Gliwice", tournaments: { name: "Turniej U12 Warszawa" } } },
    conversation_participants: [
      { account_id: ME, accounts: { full_name: "Test Rodzic" } },
      { account_id: OTHER, accounts: { full_name: "Anna Kierowca" } },
    ],
  },
];
fake.db.messages = [
  { id: "m-1", conversation_id: "conv-demo-1", sender_account_id: OTHER, body: "Dzień dobry, jedziemy w czwartek o 7:00 spod Auchan w Gliwicach.", created_at: hoursAgo(4) },
  { id: "m-2", conversation_id: "conv-demo-1", sender_account_id: ME, body: "Świetnie, pasuje nam. Zabieramy dwie torby z rakietami.", created_at: hoursAgo(3) },
  { id: "m-3", conversation_id: "conv-demo-1", sender_account_id: OTHER, body: "Super. W takim razie do zobaczenia w czwartek!", created_at: hoursAgo(2) },
];

// Widok trenera do oglądania panelu klubu: adres ...?demo=trener albo budowa z VITE_DEMO_COACH=1
if (import.meta.env.VITE_DEMO_COACH === "1" || (typeof location !== "undefined" && new URLSearchParams(location.search).get("demo") === "trener")) {
  const me = fake.db.accounts.find((a) => a.id === ME);
  Object.assign(me, { role: "coach", full_name: "Test Trener", club_name: "ATZ" });
}

export const supabase = fakeSupabase;
export const DEMO_MODE = true;
