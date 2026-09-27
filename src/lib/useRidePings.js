import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase.js";

const SELECT = `*,
  requester_trip:trips!ride_pings_requester_trip_id_fkey(departure_city, created_by_account_id, players(first_name), tournaments(name)),
  target_trip:trips!ride_pings_target_trip_id_fkey(departure_city, created_by_account_id, players(first_name), tournaments(name))`;

// "Poproś o podwiezienie" — zapytania niezależne od oferty przejazdu,
// wysyłane wprost do zawodnika z oficjalnej listy startowej PZT (patrz
// useTournamentMatches.js). Ten sam wzorzec akceptacji + tworzenia rozmowy
// co useJoinRequests.js, tylko trzecia droga powstania czatu
// (0028_ride_pings.sql).
export function useRidePings(accountId) {
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
    const { data, error } = await supabase.from("ride_pings").select(SELECT).order("created_at", { ascending: false });
    if (error) setError(error.message);
    else {
      setError(null);
      setRows(data ?? []);
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const incoming = rows.filter((r) => r.target_trip?.created_by_account_id === accountId);
  const outgoing = rows.filter((r) => r.requester_trip?.created_by_account_id === accountId);

  const sendPing = async ({ tournamentId, requesterTripId, targetTripId }) => {
    const { data, error } = await supabase
      .from("ride_pings")
      .insert({ tournament_id: tournamentId, requester_trip_id: requesterTripId, target_trip_id: targetTripId })
      .select(SELECT)
      .single();
    if (error) return { error };
    setRows((prev) => [data, ...prev]);
    return { data };
  };

  const respond = async (pingId, status) => {
    const { data, error } = await supabase
      .from("ride_pings")
      .update({ status })
      .eq("id", pingId)
      .select(SELECT)
      .single();
    if (error) return { error };
    setRows((prev) => prev.map((r) => (r.id === pingId ? data : r)));

    let warning = null;
    if (status === "accepted") {
      const requesterAccountId = data.requester_trip?.created_by_account_id;
      const targetAccountId = data.target_trip?.created_by_account_id;
      // Patrz komentarz w useJoinRequests.js respond(): insert bez .select()
      // po nim, bo RETURNING podlega polityce SELECT na `conversations`,
      // która w chwili insertu jeszcze nikogo nie uznaje za uczestnika.
      const conversationId = crypto.randomUUID();
      const { error: convError } = await supabase
        .from("conversations")
        .insert({ id: conversationId, kind: "direct", ride_ping_id: pingId });
      if (convError) {
        console.error("[useRidePings] Nie udało się utworzyć rozmowy:", convError.message);
        warning = "Zaakceptowano, ale nie udało się otworzyć czatu. Odśwież stronę i spróbuj ponownie.";
      } else {
        const { error: participantsError } = await supabase.from("conversation_participants").insert([
          { conversation_id: conversationId, account_id: requesterAccountId },
          { conversation_id: conversationId, account_id: targetAccountId },
        ]);
        if (participantsError) {
          console.error("[useRidePings] Nie udało się dodać uczestników rozmowy:", participantsError.message);
          warning = "Zaakceptowano, ale nie udało się otworzyć czatu. Odśwież stronę i spróbuj ponownie.";
        }
      }
    }
    return { data, warning };
  };

  return { incoming, outgoing, loading, error, sendPing, respond, refresh };
}
