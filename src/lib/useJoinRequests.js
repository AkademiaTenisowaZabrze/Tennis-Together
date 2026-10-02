import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase.js";

// "Poproś o miejsce" (przejazdy) / "Dołącz" (noclegi) — prośby o dołączenie
// do cudzej oferty. RLS (supabase/migrations/0007_join_requests_rls.sql)
// pokazuje każdemu tylko prośby, w których jest stroną (proszący albo
// właściciel oferty), więc jedno zapytanie bez dodatkowych filtrów już
// zwraca dokładnie to, co ten użytkownik powinien widzieć — tu tylko
// dzielimy wynik na "przychodzące" (moje oferty) i "wychodzące" (moje
// prośby), po `created_by_account_id` w embedowanych wyjazdach.
//
// `kind`: "ride" | "lodging" — te dwie tabele mają identyczny kształt,
// stąd jeden hook zamiast kopiowania dwa razy.
const CONFIG = {
  ride: {
    table: "ride_join_requests",
    offerFk: "ride_offer_id",
    offerEmbed:
      "ride_offers(id, free_seats, luggage_space, cost_split_suggestion, cost_per_person_pln, trips(departure_city, created_by_account_id, players(first_name), tournaments(name)))",
  },
  lodging: {
    table: "lodging_join_requests",
    offerFk: "lodging_offer_id",
    offerEmbed:
      "lodging_offers(id, kind, place_name, free_spots, trips(departure_city, created_by_account_id, players(first_name), tournaments(name)))",
  },
};

export function useJoinRequests(kind, accountId) {
  const cfg = CONFIG[kind];
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!accountId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from(cfg.table)
      .select(`*, requester_trip:trips(departure_city, created_by_account_id, players(first_name)), ${cfg.offerEmbed}`)
      .order("created_at", { ascending: false });

    if (error) setError(error.message);
    else {
      setError(null);
      setRows(data ?? []);
    }
    setLoading(false);
  }, [cfg, accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const offerKey = cfg.offerFk.startsWith("ride") ? "ride_offers" : "lodging_offers";
  const incoming = rows.filter((r) => r[offerKey]?.trips?.created_by_account_id === accountId);
  const outgoing = rows.filter((r) => r.requester_trip?.created_by_account_id === accountId);

  const requestToJoin = async ({ offerId, requesterTripId }) => {
    const { data, error } = await supabase
      .from(cfg.table)
      .insert({ [cfg.offerFk]: offerId, requester_trip_id: requesterTripId })
      .select(`*, requester_trip:trips(departure_city, created_by_account_id, players(first_name)), ${cfg.offerEmbed}`)
      .single();
    if (error) return { error };
    setRows((prev) => [data, ...prev]);
    return { data };
  };

  const respond = async (requestId, status) => {
    const { data, error } = await supabase
      .from(cfg.table)
      .update({ status })
      .eq("id", requestId)
      .select(`*, requester_trip:trips(departure_city, created_by_account_id, players(first_name)), ${cfg.offerEmbed}`)
      .single();
    if (error) return { error };
    setRows((prev) => prev.map((r) => (r.id === requestId ? data : r)));

    // Akceptacja odblokowuje wspólną rozmowę — patrz RLS w
    // 0008_messages_rls.sql (jedyna droga do rozmowy to zaakceptowana
    // prośba). Best-effort: jeśli się nie uda, prośba i tak jest
    // zaakceptowana, tylko czat trzeba by dodać ręcznie później.
    let warning = null;
    if (status === "accepted") {
      const requesterAccountId = data.requester_trip?.created_by_account_id;
      if (!requesterAccountId || !accountId) {
        // Nie powinno się zdarzyć przy poprawnym RLS (patrz
        // 0010_fix_requester_trip_visibility.sql) — zostawiamy ślad
        // zamiast cicho pomijać tworzenie rozmowy, jak wcześniej.
        console.error(
          "[useJoinRequests] Brak requester_trip.created_by_account_id — rozmowa NIE powstała dla",
          requestId
        );
        warning = "Zaakceptowano, ale nie udało się otworzyć czatu. Odśwież stronę i spróbuj ponownie.";
      } else {
        // UWAGA: id generujemy PO STRONIE KLIENTA i wstawiamy bez
        // .select() po insercie. Gdyby dociągnąć id z powrotem przez
        // .select().single(), PostgREST robi INSERT ... RETURNING, a to
        // podlega polityce SELECT na `conversations`
        // (is_conversation_participant) — w momencie insertu NIKT
        // jeszcze nie jest uczestnikiem (dodajemy ich dopiero linijkę
        // niżej), więc RETURNING nie znajduje wiersza i Postgres zgłasza
        // "new row violates row-level security policy". Realny błąd
        // złapany na żywo w testach z Pawłem — rozmowa nigdy nie
        // powstawała mimo poprawnych polityk RLS.
        const conversationId = crypto.randomUUID();
        const { error: convError } = await supabase
          .from("conversations")
          .insert({ id: conversationId, kind, [cfg.offerFk]: data[cfg.offerFk] });
        if (convError) {
          console.error("[useJoinRequests] Nie udało się utworzyć rozmowy:", convError.message);
          warning = "Zaakceptowano, ale nie udało się otworzyć czatu. Odśwież stronę i spróbuj ponownie.";
        } else {
          const { error: participantsError } = await supabase.from("conversation_participants").insert([
            { conversation_id: conversationId, account_id: accountId },
            { conversation_id: conversationId, account_id: requesterAccountId },
          ]);
          if (participantsError) {
            console.error("[useJoinRequests] Nie udało się dodać uczestników rozmowy:", participantsError.message);
            warning = "Zaakceptowano, ale nie udało się otworzyć czatu. Odśwież stronę i spróbuj ponownie.";
          }
        }
      }
    }

    return { data, warning };
  };

  // "Cofnij prośbę" — proszący rezygnuje, zanim właściciel oferty
  // zdążył odpowiedzieć. RLS (0007_join_requests_rls.sql, polityka
  // "Proszący usuwa swoją prośbę...") już na to pozwala od początku —
  // brakowało tylko przycisku w UI.
  const withdraw = async (requestId) => {
    const { error } = await supabase.from(cfg.table).delete().eq("id", requestId);
    if (error) return { error };
    setRows((prev) => prev.filter((r) => r.id !== requestId));
    return {};
  };

  // Potwierdzenie spotkania kodem/QR (PLAN.md, "z kim ja właściwie jadę")
  // — jedna strona generuje kod, druga go wpisuje (albo zeskanuje QR
  // zwykłym aparatem i przepisze). Porównanie robi baza (drugi .eq()
  // niżej), nie lokalny stan — inaczej strona wpisująca kod działałaby na
  // nieaktualnej kopii wiersza, sprzed wygenerowania kodu przez drugą
  // stronę (ten hook nie ma subskrypcji live, tylko refresh na żądanie).
  const MEETING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // bez 0/O, 1/I — łatwiej przepisać

  const generateMeetingCode = async (requestId) => {
    const code = Array.from(
      { length: 6 },
      () => MEETING_CODE_ALPHABET[Math.floor(Math.random() * MEETING_CODE_ALPHABET.length)]
    ).join("");
    const { data, error } = await supabase
      .from(cfg.table)
      .update({ meeting_code: code })
      .eq("id", requestId)
      .select(`*, requester_trip:trips(departure_city, created_by_account_id, players(first_name)), ${cfg.offerEmbed}`)
      .single();
    if (error) return { error };
    setRows((prev) => prev.map((r) => (r.id === requestId ? data : r)));
    return { data };
  };

  // Kod sprawdza funkcja w bazie (confirm_meeting, patrz
  // 0026_meeting_confirmation_server_side.sql), a nie przeglądarka: baza
  // liczy błędne próby, nie pozwala potwierdzić własnym kodem i odrzuca
  // każdą inną drogę ustawienia potwierdzenia.
  const verifyMeetingCode = async (requestId, enteredCode) => {
    const { data: res, error } = await supabase.rpc("confirm_meeting", {
      p_request_id: requestId,
      p_kind: kind,
      p_code: enteredCode,
    });
    if (error) return { error };
    if (res?.result !== "ok" && res?.result !== "already") {
      return { failure: res?.result ?? "error", attemptsLeft: res?.attempts_left };
    }
    const { data, error: readError } = await supabase
      .from(cfg.table)
      .select(`*, requester_trip:trips(departure_city, created_by_account_id, players(first_name)), ${cfg.offerEmbed}`)
      .eq("id", requestId)
      .single();
    if (readError) return { error: readError };
    setRows((prev) => prev.map((r) => (r.id === requestId ? data : r)));
    return { data };
  };

  return {
    incoming,
    outgoing,
    loading,
    error,
    requestToJoin,
    respond,
    withdraw,
    generateMeetingCode,
    verifyMeetingCode,
    refresh,
  };
}
