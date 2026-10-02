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

// ── Tryb "request_accepted" (0033_push_request_accepted.sql) ──────────────
// Powiadamia proszącego, że druga strona zaakceptowała jego prośbę. W treści
// pusha celowo bez imion (ekran blokady widzi każdy).
const ACCEPTED_CONFIG: Record<string, { table: string; select: string; label: string }> = {
  ride: {
    table: "ride_join_requests",
    select: "id, requester_trip:trips(created_by_account_id), ride_offers(trips(tournaments(name)))",
    label: "przejazd",
  },
  lodging: {
    table: "lodging_join_requests",
    select: "id, requester_trip:trips(created_by_account_id), lodging_offers(trips(tournaments(name)))",
    label: "nocleg",
  },
  ride_ping: {
    table: "ride_pings",
    select:
      "id, requester_trip:trips!ride_pings_requester_trip_id_fkey(created_by_account_id), tournaments(name)",
    label: "podwiezienie",
  },
  host_lodging: {
    table: "lodging_host_requests",
    select: "id, requester_trip:trips(created_by_account_id), lodging_host_offers(tournaments(name))",
    label: "nocleg u rodziny",
  },
};

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

async function handleRequestAccepted(requestKind: unknown, requestId: unknown) {
  const cfg = typeof requestKind === "string" ? ACCEPTED_CONFIG[requestKind] : undefined;
  if (!cfg || typeof requestId !== "string") {
    return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
  }

  // Jednorazowy bilet: tylko pierwsze wywołanie dla zaakceptowanej prośby
  // przechodzi dalej (patrz komentarz w 0033).
  const { data: row, error } = await supabase
    .from(cfg.table)
    .update({ push_sent_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "accepted")
    .is("push_sent_at", null)
    .select(cfg.select)
    .maybeSingle();
  if (error) throw error;
  if (!row) return new Response(JSON.stringify({ skipped: "already sent or not accepted" }), { status: 200 });

  // deno-lint-ignore no-explicit-any
  const requesterAccountId = (row as any).requester_trip?.created_by_account_id;
  if (!requesterAccountId) return new Response(JSON.stringify({ notified: 0 }), { status: 200 });

  const { data: tokens, error: tokensError } = await supabase
    .from("device_tokens")
    .select("token")
    .eq("account_id", requesterAccountId);
  if (tokensError) throw tokensError;
  if (!tokens || tokens.length === 0) return new Response(JSON.stringify({ notified: 0 }), { status: 200 });

  const title = `✅ Prośba zaakceptowana (${cfg.label})`;
  const body = `${tournamentNameOf(row)} — otwórz aplikację, żeby napisać do drugiej strony.`;
  const accessToken = await getAccessToken(JSON.parse(SERVICE_ACCOUNT_RAW));
  await Promise.all(tokens.map((t) => sendPush(accessToken, t.token, title, body)));
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
    if (payload?.event === "request_accepted") {
      return await handleRequestAccepted(payload.request_kind, payload.request_id);
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
