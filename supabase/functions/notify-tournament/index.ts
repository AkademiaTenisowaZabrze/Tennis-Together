// notify-tournament — wywoływana przez trigger bazy (notify_new_offer(),
// patrz 0020_push_notifications.sql) po każdej nowej ofercie
// przejazdu/noclegu. Znajduje wszystkich innych, którzy jadą na TEN SAM
// turniej, i wysyła im push przez Firebase Cloud Messaging (HTTP v1 API).
//
// Wymagane sekrety tej funkcji (patrz README.md w tym folderze):
//   FIREBASE_PROJECT_ID
//   FIREBASE_SERVICE_ACCOUNT_JSON
//
// SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY są wstrzykiwane automatycznie
// przez środowisko Edge Function — nie trzeba ich ustawiać ręcznie.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID") ?? "";
const SERVICE_ACCOUNT_RAW = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Google OAuth2, przepływ "service account JWT-bearer" ──────────────────
// Standardowy, udokumentowany przepływ Google (nie coś specyficznego dla
// Firebase) — podpisujemy własny JWT kluczem prywatnym z pliku konta
// serwisowego i wymieniamy go na krótkotrwały access_token.

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(serviceAccount: { client_email: string; private_key: string }): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Błąd wymiany tokenu Google: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

async function sendPush(accessToken: string, token: string, title: string, body: string) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ message: { token, notification: { title, body } } }),
  });
  if (!res.ok) {
    // Pojedynczy nieprawidłowy/wygasły token nie powinien wywalać całej
    // wysyłki do reszty odbiorców — logujemy i jedziemy dalej.
    console.error(`FCM: błąd wysyłki dla tokenu ${token.slice(0, 12)}…: ${res.status} ${await res.text()}`);
  }
}

// ── Tryby "request_accepted" / "request_created" (0033, 0034) ─────────────
// accepted: powiadamia PROSZĄCEGO, że druga strona zaakceptowała prośbę.
// created: powiadamia WŁAŚCICIELA oferty (albo adresata zapytania o
// podwiezienie), że ktoś o coś poprosił. W treści pusha celowo bez imion
// (ekran blokady widzi każdy).
type RequestCfg = { table: string; select: string; label: string };
const REQUEST_CONFIG: Record<string, RequestCfg> = {
  ride: {
    table: "ride_join_requests",
    select:
      "id, requester_trip:trips(created_by_account_id), ride_offers(trips(created_by_account_id, tournaments(name)))",
    label: "przejazd",
  },
  lodging: {
    table: "lodging_join_requests",
    select:
      "id, requester_trip:trips(created_by_account_id), lodging_offers(trips(created_by_account_id, tournaments(name)))",
    label: "nocleg",
  },
  ride_ping: {
    table: "ride_pings",
    select:
      "id, requester_trip:trips!ride_pings_requester_trip_id_fkey(created_by_account_id), " +
      "target_trip:trips!ride_pings_target_trip_id_fkey(created_by_account_id), tournaments(name)",
    label: "podwiezienie",
  },
  host_lodging: {
    table: "lodging_host_requests",
    select:
      "id, requester_trip:trips(created_by_account_id), lodging_host_offers(host_account_id, tournaments(name))",
    label: "nocleg u rodziny",
  },
};

const EVENTS = {
  request_accepted: {
    guardColumn: "push_sent_at",
    status: "accepted",
    title: (label: string) => `✅ Prośba zaakceptowana (${label})`,
    text: (tournament: string) => `${tournament} — otwórz aplikację, żeby napisać do drugiej strony.`,
    // deno-lint-ignore no-explicit-any
    recipient: (row: any) => row.requester_trip?.created_by_account_id as string | undefined,
  },
  request_created: {
    guardColumn: "created_push_sent_at",
    status: "pending",
    title: (label: string) => `📩 Nowa prośba (${label})`,
    text: (tournament: string) => `${tournament} — ktoś o coś prosi, otwórz aplikację i odpowiedz.`,
    // deno-lint-ignore no-explicit-any
    recipient: (row: any) =>
      (row.ride_offers?.trips?.created_by_account_id ??
        row.lodging_offers?.trips?.created_by_account_id ??
        row.target_trip?.created_by_account_id ??
        row.lodging_host_offers?.host_account_id) as string | undefined,
  },
  // 0037: druga strona ustawila pineske miejsca spotkania. Powiadomienie dostaje
  // ta strona, ktora pineski NIE ustawila. Zamiast jednorazowego biletu jest
  // odstep (throttleMinutes), zeby wielokrotne przesuwanie pineski nie spamowalo.
  meeting_point_set: {
    guardColumn: "meeting_point_push_at",
    status: "accepted",
    kinds: ["ride", "ride_ping"],
    throttleMinutes: 5,
    // Kolumna z 0036 - dopinana tylko dla tego zdarzenia, zeby pozostale
    // powiadomienia dzialaly tez przed uruchomieniem 0036 w bazie.
    extraSelect: "meeting_point_set_by",
    title: (_label: string) => "📍 Ustalono miejsce spotkania",
    text: (tournament: string) => `${tournament} — sprawdź pineskę na mapie w aplikacji.`,
    // deno-lint-ignore no-explicit-any
    recipient: (row: any) => {
      const requester = row.requester_trip?.created_by_account_id as string | undefined;
      const owner = (row.ride_offers?.trips?.created_by_account_id ??
        row.target_trip?.created_by_account_id) as string | undefined;
      return (row.meeting_point_set_by === requester ? owner : requester) as string | undefined;
    },
  },
  // 0040: spotkanie potwierdzone kodem. Powiadomienie dostaje strona, ktora
  // kodu NIE wpisala (potwierdzenie robi ta, ktora wpisuje kod drugiej).
  meeting_confirmed: {
    guardColumn: "confirmed_push_sent_at",
    status: "accepted",
    kinds: ["ride", "lodging", "host_lodging"],
    requireNotNull: "meeting_confirmed_at",
    extraSelect: "meeting_confirmed_by",
    title: (_label: string) => "🤝 Spotkanie potwierdzone",
    text: (tournament: string) => `${tournament} — możesz teraz ocenić drugą stronę w aplikacji.`,
    // deno-lint-ignore no-explicit-any
    recipient: (row: any) => {
      const requester = row.requester_trip?.created_by_account_id as string | undefined;
      const owner = (row.ride_offers?.trips?.created_by_account_id ??
        row.lodging_offers?.trips?.created_by_account_id ??
        row.lodging_host_offers?.host_account_id) as string | undefined;
      return (row.meeting_confirmed_by === requester ? owner : requester) as string | undefined;
    },
  },
  // 0038: prosba odrzucona albo druga strona zrezygnowala. Powiadamiamy strone,
  // ktora tego NIE zrobila - kto to zrobil, wiemy z actor_id przekazanego przez
  // trigger (auth.uid()). Zmiany systemowe (wygaszanie przeterminowanych
  // prosb, 0034) nie maja aktora, wiec nikogo nie powiadamiaja.
  request_closed: {
    guardColumn: "closed_push_sent_at",
    status: "declined",
    statuses: ["declined", "cancelled"],
    // deno-lint-ignore no-explicit-any
    title: (label: string, row: any) =>
      row.status === "declined" ? `❌ Prośba odrzucona (${label})` : `⚠️ Druga strona zrezygnowała (${label})`,
    // deno-lint-ignore no-explicit-any
    text: (tournament: string, row: any) =>
      row.status === "declined"
        ? `${tournament} — poszukaj innej oferty w aplikacji.`
        : `${tournament} — sprawdź w aplikacji, czy trzeba coś zorganizować inaczej.`,
    // deno-lint-ignore no-explicit-any
    recipient: (row: any, actorId?: string) => {
      if (!actorId) return undefined;
      const requester = row.requester_trip?.created_by_account_id as string | undefined;
      const owner = (row.ride_offers?.trips?.created_by_account_id ??
        row.lodging_offers?.trips?.created_by_account_id ??
        row.target_trip?.created_by_account_id ??
        row.lodging_host_offers?.host_account_id) as string | undefined;
      if (actorId === requester) return owner;
      if (actorId === owner) return requester;
      return undefined;
    },
  },
} as const;

// deno-lint-ignore no-explicit-any
function tournamentNameOf(row: any): string {
  return (
    row.ride_offers?.trips?.tournaments?.name ??
    row.lodging_offers?.trips?.tournaments?.name ??
    row.tournaments?.name ??
    row.lodging_host_offers?.tournaments?.name ??
    "turniej"
  );
}

async function handleRequestEvent(
  eventName: keyof typeof EVENTS,
  requestKind: unknown,
  requestId: unknown,
  actorId?: unknown,
) {
  const cfg = typeof requestKind === "string" ? REQUEST_CONFIG[requestKind] : undefined;
  const ev = EVENTS[eventName];
  if (!cfg || typeof requestId !== "string") {
    return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
  }

  // deno-lint-ignore no-explicit-any
  const evAny = ev as any;
  if (evAny.kinds && !evAny.kinds.includes(requestKind)) {
    return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
  }

  // Bilet: domyślnie jednorazowy (kolumna jeszcze pusta), a dla zdarzeń z
  // throttleMinutes — dozwolony ponownie po upływie odstępu (patrz 0033/0034/0037).
  let q = supabase
    .from(cfg.table)
    .update({ [ev.guardColumn]: new Date().toISOString() })
    .eq("id", requestId);
  q = evAny.statuses ? q.in("status", evAny.statuses) : q.eq("status", evAny.status);
  if (evAny.throttleMinutes) {
    const cutoff = new Date(Date.now() - evAny.throttleMinutes * 60 * 1000).toISOString();
    q = q
      .not("meeting_lat", "is", null)
      .or(`${ev.guardColumn}.is.null,${ev.guardColumn}.lt.${cutoff}`);
  } else {
    q = q.is(ev.guardColumn, null);
    if (evAny.requireNotNull) q = q.not(evAny.requireNotNull, "is", null);
  }
  const { data: row, error } = await q
    .select(evAny.extraSelect ? `${cfg.select}, ${evAny.extraSelect}` : cfg.select)
    .maybeSingle();
  if (error) throw error;
  if (!row) return new Response(JSON.stringify({ skipped: "already sent or wrong status" }), { status: 200 });

  const recipientId = evAny.recipient(row, typeof actorId === "string" ? actorId : undefined);
  if (!recipientId) return new Response(JSON.stringify({ notified: 0 }), { status: 200 });

  const { data: tokens, error: tokensError } = await supabase
    .from("device_tokens")
    .select("token")
    .eq("account_id", recipientId);
  if (tokensError) throw tokensError;
  if (!tokens || tokens.length === 0) return new Response(JSON.stringify({ notified: 0 }), { status: 200 });

  const accessToken = await getAccessToken(JSON.parse(SERVICE_ACCOUNT_RAW));
  await Promise.all(
    tokens.map((t) =>
      sendPush(accessToken, t.token, evAny.title(cfg.label, row), evAny.text(tournamentNameOf(row), row))
    )
  );
  return new Response(JSON.stringify({ notified: tokens.length }), { status: 200 });
}

// ── Tryb "new_message" (0038) ──────────────────────────────────────────────
// Powiadamia pozostałych uczestników rozmowy o nowej wiadomości — bez treści
// (ekran blokady widzi każdy). Dla każdego uczestnika nie częściej niż raz na
// 2 minuty (conversation_participants.last_push_at), żeby żywa rozmowa nie
// zasypywała telefonu. Ostatnia linia obrony przed spamem z publicznego klucza:
// liczy się tylko świeża wiadomość (ostatnie 2 minuty), jak przy ofertach.
async function handleNewMessage(messageId: unknown) {
  if (typeof messageId !== "string") {
    return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
  }
  const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: msg, error: msgError } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_account_id")
    .eq("id", messageId)
    .gte("created_at", since)
    .maybeSingle();
  if (msgError) throw msgError;
  if (!msg) return new Response(JSON.stringify({ skipped: "no fresh message" }), { status: 200 });

  const { data: claimed, error: claimError } = await supabase
    .from("conversation_participants")
    .update({ last_push_at: new Date().toISOString() })
    .eq("conversation_id", msg.conversation_id)
    .neq("account_id", msg.sender_account_id)
    .or(`last_push_at.is.null,last_push_at.lt.${since}`)
    .select("account_id");
  if (claimError) throw claimError;
  const accountIds = (claimed ?? []).map((c) => c.account_id);
  if (accountIds.length === 0) return new Response(JSON.stringify({ notified: 0 }), { status: 200 });

  const { data: tokens, error: tokensError } = await supabase
    .from("device_tokens")
    .select("token")
    .in("account_id", accountIds);
  if (tokensError) throw tokensError;
  if (!tokens || tokens.length === 0) return new Response(JSON.stringify({ notified: 0 }), { status: 200 });

  const accessToken = await getAccessToken(JSON.parse(SERVICE_ACCOUNT_RAW));
  await Promise.all(
    tokens.map((t) => sendPush(accessToken, t.token, "💬 Nowa wiadomość", "Otwórz aplikację, żeby ją przeczytać."))
  );
  return new Response(JSON.stringify({ notified: tokens.length }), { status: 200 });
}

// ── Tryb "selection_published" (0039) ──────────────────────────────────────
// PZT opublikował listę startową: powiadamia wszystkich z wyjazdem na ten
// turniej. Jednorazowo na turniej (tournaments.selection_push_at); wołane przez
// scripts/import_tournament_entries.py. Zabezpieczenie przed wcześniejszym
// wywołaniem z publicznego klucza: bilet jest zajmowany dopiero, gdy lista
// faktycznie jest w bazie.
async function handleSelectionPublished(tournamentId: unknown) {
  if (typeof tournamentId !== "string") {
    return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
  }
  const { count, error: countError } = await supabase
    .from("tournament_entries")
    .select("tournament_id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);
  if (countError) throw countError;
  if (!count) return new Response(JSON.stringify({ skipped: "no entries yet" }), { status: 200 });

  const { data: tournament, error } = await supabase
    .from("tournaments")
    .update({ selection_push_at: new Date().toISOString() })
    .eq("id", tournamentId)
    .is("selection_push_at", null)
    .select("name")
    .maybeSingle();
  if (error) throw error;
  if (!tournament) return new Response(JSON.stringify({ skipped: "already sent" }), { status: 200 });

  const { data: trips, error: tripsError } = await supabase
    .from("trips")
    .select("created_by_account_id")
    .eq("tournament_id", tournamentId);
  if (tripsError) throw tripsError;
  const accountIds = [...new Set((trips ?? []).map((t) => t.created_by_account_id))];
  if (accountIds.length === 0) return new Response(JSON.stringify({ notified: 0 }), { status: 200 });

  const { data: tokens, error: tokensError } = await supabase
    .from("device_tokens")
    .select("token")
    .in("account_id", accountIds);
  if (tokensError) throw tokensError;
  if (!tokens || tokens.length === 0) return new Response(JSON.stringify({ notified: 0 }), { status: 200 });

  const accessToken = await getAccessToken(JSON.parse(SERVICE_ACCOUNT_RAW));
  await Promise.all(
    tokens.map((t) =>
      sendPush(
        accessToken,
        t.token,
        "📋 Lista startowa PZT opublikowana",
        `${tournament.name} — zobacz w Moich wyjazdach, kto jeszcze jedzie, i poproś o podwiezienie.`
      )
    )
  );
  return new Response(JSON.stringify({ notified: tokens.length }), { status: 200 });
}

// ── Tryb "trip_reminders" (0039) ───────────────────────────────────────────
// Wołany raz dziennie przez GitHub Actions (.github/workflows/trip-reminders.yml)
// z days=1 (jutro turniej) i days=7 (za tydzień, brakuje transportu). Wybór
// wyjazdów i jednorazowość robi claim_trip_reminders() w bazie.
async function handleTripReminders(days: unknown) {
  if (days !== 1 && days !== 7) {
    return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
  }
  const reminders = await sendTripReminders(days);
  // Tygodniowe podsumowanie dla trenerów idzie razem z przypomnieniem "za tydzień".
  let digests = 0;
  if (days === 7) {
    try {
      digests = await sendCoachDigests();
    } catch (err) {
      // Brak funkcji claim_coach_digests (przed 0040) albo chwilowy błąd nie
      // może psuć zwykłych przypomnień, które już poszły.
      console.error("notify-tournament: podsumowanie dla trenerów nie powiodło się:", err);
    }
  }
  return new Response(JSON.stringify({ notified: reminders, coach_digests: digests }), { status: 200 });
}

async function sendTripReminders(days: 1 | 7): Promise<number> {
  const { data: rows, error } = await supabase.rpc("claim_trip_reminders", { p_days: days });
  if (error) throw error;
  if (!rows || rows.length === 0) return 0;

  const list = rows as Array<{ account_id: string; tournament_name: string; ride_status: string }>;
  const accountIds = [...new Set(list.map((r) => r.account_id))];
  const { data: tokens, error: tokensError } = await supabase
    .from("device_tokens")
    .select("account_id, token")
    .in("account_id", accountIds);
  if (tokensError) throw tokensError;
  if (!tokens || tokens.length === 0) return 0;

  const accessToken = await getAccessToken(JSON.parse(SERVICE_ACCOUNT_RAW));
  let sent = 0;
  for (const r of list) {
    const rideMissing = r.ride_status === "none" || r.ride_status === "pending";
    const title = days === 1 ? "🎾 Jutro turniej" : "⏰ Za tydzień turniej";
    const body =
      days === 1
        ? `${r.tournament_name}${rideMissing ? " — transport wciąż nie jest ustalony." : " — sprawdź miejsce spotkania w aplikacji."}`
        : `${r.tournament_name} — transport jeszcze nie jest ustalony. Poszukaj przejazdu w aplikacji.`;
    const mine = tokens.filter((t) => t.account_id === r.account_id);
    await Promise.all(mine.map((t) => sendPush(accessToken, t.token, title, body)));
    sent += mine.length;
  }
  return sent;
}

// Trener: "w klubie N osób nie ma jeszcze transportu na turniej za tydzień"
// (0040, claim_coach_digests — raz na trenera i turniej).
async function sendCoachDigests(): Promise<number> {
  const { data: rows, error } = await supabase.rpc("claim_coach_digests");
  if (error) throw error;
  if (!rows || rows.length === 0) return 0;

  const list = rows as Array<{ coach_account_id: string; tournament_name: string; missing_ride: number }>;
  const { data: tokens, error: tokensError } = await supabase
    .from("device_tokens")
    .select("account_id, token")
    .in("account_id", [...new Set(list.map((r) => r.coach_account_id))]);
  if (tokensError) throw tokensError;
  if (!tokens || tokens.length === 0) return 0;

  const accessToken = await getAccessToken(JSON.parse(SERVICE_ACCOUNT_RAW));
  let sent = 0;
  for (const r of list) {
    const mine = tokens.filter((t) => t.account_id === r.coach_account_id);
    const body = `${r.tournament_name} (za tydzień) — transportu wciąż nie ma ustalonego dla: ${r.missing_ride}. Zobacz w panelu klubu.`;
    await Promise.all(mine.map((t) => sendPush(accessToken, t.token, "🚗 Brakujący transport w klubie", body)));
    sent += mine.length;
  }
  return sent;
}

// ── Tryb "club_trip_created" (0040) ────────────────────────────────────────
// Zawodnik z klubu zgłosił wyjazd -> push do trenera(ów) tego klubu. Tylko
// świeże wyjazdy (2 min) i odstęp 60 min na trenera i turniej, żeby klubowe
// zgłoszenia hurtem nie zasypały trenera. Bez nazwisk w treści.
async function handleClubTripCreated(tripId: unknown) {
  if (typeof tripId !== "string") {
    return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
  }
  const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: trip, error } = await supabase
    .from("trips")
    .select("tournament_id, tournaments(name), players(club_name)")
    .eq("id", tripId)
    .gte("created_at", since)
    .maybeSingle();
  if (error) throw error;
  if (!trip) return new Response(JSON.stringify({ skipped: "no fresh trip" }), { status: 200 });

  // deno-lint-ignore no-explicit-any
  const t = trip as any;
  const club = String(t.players?.club_name ?? "").trim().toLowerCase();
  if (!club) return new Response(JSON.stringify({ skipped: "player without club" }), { status: 200 });

  const { data: coaches, error: coachError } = await supabase
    .from("accounts")
    .select("id, club_name")
    .eq("role", "coach")
    .not("club_name", "is", null);
  if (coachError) throw coachError;
  const matching = (coaches ?? []).filter((c) => String(c.club_name).trim().toLowerCase() === club);

  const toNotify: string[] = [];
  for (const c of matching) {
    const { data: ok, error: slotError } = await supabase.rpc("claim_push_slot", {
      p_key: `coach_trip_${c.id}_${t.tournament_id}`,
      p_minutes: 60,
    });
    if (slotError) throw slotError;
    if (ok) toNotify.push(c.id);
  }
  if (toNotify.length === 0) return new Response(JSON.stringify({ notified: 0 }), { status: 200 });

  const { data: tokens, error: tokensError } = await supabase
    .from("device_tokens")
    .select("token")
    .in("account_id", toNotify);
  if (tokensError) throw tokensError;
  if (!tokens || tokens.length === 0) return new Response(JSON.stringify({ notified: 0 }), { status: 200 });

  const accessToken = await getAccessToken(JSON.parse(SERVICE_ACCOUNT_RAW));
  await Promise.all(
    tokens.map((tk) =>
      sendPush(
        accessToken,
        tk.token,
        "🎾 Nowy wyjazd w klubie",
        `${t.tournaments?.name ?? "Turniej"} — ktoś z klubu zgłosił wyjazd. Zobacz w panelu klubu.`
      )
    )
  );
  return new Response(JSON.stringify({ notified: tokens.length }), { status: 200 });
}

// ── Tryb "admin_report" (0040) ─────────────────────────────────────────────
// Nowe zgłoszenie błędu (formularz publiczny!) albo nadużycia -> push do
// administratorów. Nie częściej niż raz na 10 minut na rodzaj zgłoszenia,
// żeby nikt nie mógł zasypać administratora; bez treści zgłoszenia.
async function handleAdminReport(source: unknown) {
  if (source !== "bug" && source !== "abuse") {
    return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
  }
  const { data: ok, error: slotError } = await supabase.rpc("claim_push_slot", {
    p_key: `admin_${source}`,
    p_minutes: 10,
  });
  if (slotError) throw slotError;
  if (!ok) return new Response(JSON.stringify({ skipped: "throttled" }), { status: 200 });

  const { data: admins, error } = await supabase.from("accounts").select("id").eq("is_admin", true);
  if (error) throw error;
  const adminIds = (admins ?? []).map((a) => a.id);
  if (adminIds.length === 0) return new Response(JSON.stringify({ notified: 0 }), { status: 200 });

  const { data: tokens, error: tokensError } = await supabase
    .from("device_tokens")
    .select("token")
    .in("account_id", adminIds);
  if (tokensError) throw tokensError;
  if (!tokens || tokens.length === 0) return new Response(JSON.stringify({ notified: 0 }), { status: 200 });

  const title = source === "bug" ? "🐞 Nowe zgłoszenie błędu" : "🚩 Nowe zgłoszenie nadużycia";
  const accessToken = await getAccessToken(JSON.parse(SERVICE_ACCOUNT_RAW));
  await Promise.all(tokens.map((t) => sendPush(accessToken, t.token, title, "Otwórz panel administratora.")));
  return new Response(JSON.stringify({ notified: tokens.length }), { status: 200 });
}

// ── Główna logika ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (!FIREBASE_PROJECT_ID || !SERVICE_ACCOUNT_RAW) {
    console.error("notify-tournament: brak FIREBASE_PROJECT_ID / FIREBASE_SERVICE_ACCOUNT_JSON — pomijam wysyłkę.");
    return new Response(JSON.stringify({ skipped: "firebase not configured" }), { status: 200 });
  }

  try {
    const payload = await req.json();
    if (payload?.event === "club_trip_created") {
      return await handleClubTripCreated(payload.trip_id);
    }
    if (payload?.event === "admin_report") {
      return await handleAdminReport(payload.source);
    }
    if (payload?.event === "selection_published") {
      return await handleSelectionPublished(payload.tournament_id);
    }
    if (payload?.event === "trip_reminders") {
      return await handleTripReminders(payload.days);
    }
    if (payload?.event === "new_message") {
      return await handleNewMessage(payload.message_id);
    }
    if (
      payload?.event === "request_accepted" ||
      payload?.event === "request_created" ||
      payload?.event === "meeting_point_set" ||
      payload?.event === "meeting_confirmed" ||
      payload?.event === "request_closed"
    ) {
      return await handleRequestEvent(payload.event, payload.request_kind, payload.request_id, payload.actor_id);
    }
    const { trip_id, offer_kind } = payload;
    if (typeof trip_id !== "string" || (offer_kind !== "ride" && offer_kind !== "lodging")) {
      return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
    }

    // Powiadamiamy tylko o ŚWIEŻEJ ofercie (dodanej w ostatnich 2 minutach).
    // Funkcję da się wywołać publicznym kluczem, więc bez tego ktoś mógłby
    // ją wołać w kółko i spamować użytkowników powiadomieniami (audyt
    // 2026-09-16). Zwykłe wywołanie z triggera po INSERT zawsze to spełnia.
    const offersTable = offer_kind === "lodging" ? "lodging_offers" : "ride_offers";
    const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: fresh } = await supabase
      .from(offersTable)
      .select("id")
      .eq("trip_id", trip_id)
      .gte("created_at", since)
      .limit(1);
    if (!fresh || fresh.length === 0) {
      return new Response(JSON.stringify({ skipped: "no fresh offer" }), { status: 200 });
    }

    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("tournament_id, departure_city, tournaments(name)")
      .eq("id", trip_id)
      .single();
    if (tripError || !trip) {
      return new Response(JSON.stringify({ error: "trip not found" }), { status: 404 });
    }

    const { data: otherTrips, error: otherError } = await supabase
      .from("trips")
      .select("created_by_account_id")
      .eq("tournament_id", trip.tournament_id)
      .neq("id", trip_id);
    if (otherError) throw otherError;

    const accountIds = [...new Set((otherTrips ?? []).map((t) => t.created_by_account_id))];
    if (accountIds.length === 0) {
      return new Response(JSON.stringify({ notified: 0 }), { status: 200 });
    }

    const { data: tokens, error: tokensError } = await supabase
      .from("device_tokens")
      .select("token")
      .in("account_id", accountIds);
    if (tokensError) throw tokensError;
    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ notified: 0 }), { status: 200 });
    }

    const kindLabel = offer_kind === "lodging" ? "nocleg" : "przejazd";
    const emoji = offer_kind === "lodging" ? "🏨" : "🚗";
    const tournamentName = (trip as unknown as { tournaments?: { name?: string } }).tournaments?.name ?? "turniej";
    const title = `${emoji} Nowa oferta na ${tournamentName}`;
    const body = `Ktoś zaproponował ${kindLabel} z ${trip.departure_city ?? "okolicy"} — sprawdź w aplikacji.`;

    const serviceAccount = JSON.parse(SERVICE_ACCOUNT_RAW);
    const accessToken = await getAccessToken(serviceAccount);
    await Promise.all(tokens.map((t) => sendPush(accessToken, t.token, title, body)));

    return new Response(JSON.stringify({ notified: tokens.length }), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
