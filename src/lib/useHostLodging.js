import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase.js";

// "Nocleg u zawodnika" (Etap 2) — rodzina goszcząca u siebie zawodnika na
// czas turnieju. Osobny hook od useLodging.js/useJoinRequests.js, bo oferta
// NIE jest powiązana z wyjazdem gospodarza (host nie musi mieć własnego
// zawodnika jadącego na TEN turniej) — patrz komentarz w
// 0031_host_family_lodging.sql po pełny model bezpieczeństwa.
const OFFER_SELECT = "*, tournaments(name, starts_on, category)";
const REQUEST_SELECT =
  "*, requester_trip:trips(departure_city, created_by_account_id, player_id, players(first_name)), " +
  "lodging_host_offers(id, city, capacity, notes, host_account_id, tournaments(name, starts_on))";

export function useHostOffers() {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("lodging_host_offers")
      .select(OFFER_SELECT)
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else {
      setError(null);
      setOffers(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createOffer = async ({ tournamentId, city, capacity, notes }) => {
    const { data, error } = await supabase
      .from("lodging_host_offers")
      .insert({ tournament_id: tournamentId, city, capacity: capacity || 1, notes: notes || null })
      .select(OFFER_SELECT)
      .single();
    if (error) return { error };
    setOffers((prev) => [data, ...prev]);
    return { data };
  };

  return { offers, loading, error, createOffer, refresh };
}

export function useHostRequests(accountId) {
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
      .from("lodging_host_requests")
      .select(REQUEST_SELECT)
      .order("created_at", { ascending: false });
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

  const incoming = rows.filter((r) => r.lodging_host_offers?.host_account_id === accountId);
  const outgoing = rows.filter((r) => r.requester_trip?.created_by_account_id === accountId);

  // Zgoda rodzica MUSI istnieć w bazie zanim ta funkcja w ogóle spróbuje
  // wstawić zgłoszenie — RLS (0031) odrzuci insert bez niej. Zawsze
  // wstawiamy nowy wiersz zgody (nie sprawdzamy duplikatów): "Zapisywana
  // z datą, nie edytowana — nowa zgoda to nowy wiersz" (0001_init.sql).
  const requestToJoin = async ({ offerId, requesterTripId, playerId }) => {
    const { error: consentError } = await supabase
      .from("consents")
      .insert({ player_id: playerId, consent_type: "host_family_stay", granted: true });
    if (consentError) return { error: consentError };

    const { data, error } = await supabase
      .from("lodging_host_requests")
      .insert({ host_offer_id: offerId, requester_trip_id: requesterTripId })
      .select(REQUEST_SELECT)
      .single();
    if (error) return { error };
    setRows((prev) => [data, ...prev]);
    return { data };
  };

  const withdraw = async (requestId) => {
    const { error } = await supabase.from("lodging_host_requests").delete().eq("id", requestId);
    if (error) return { error };
    setRows((prev) => prev.filter((r) => r.id !== requestId));
    return {};
  };

  // Akceptacja odblokowuje wspólną rozmowę — identyczny wzorzec i te same
  // powody (client-generated id, bez .select() od razu po insercie) co
  // useJoinRequests.js/useRidePings.js.
  const respond = async (requestId, status) => {
    const { data, error } = await supabase
      .from("lodging_host_requests")
      .update({ status })
      .eq("id", requestId)
      .select(REQUEST_SELECT)
      .single();
    if (error) return { error };
    setRows((prev) => prev.map((r) => (r.id === requestId ? data : r)));

    let warning = null;
    if (status === "accepted") {
      const requesterAccountId = data.requester_trip?.created_by_account_id;
      const hostAccountId = data.lodging_host_offers?.host_account_id;
      if (!requesterAccountId || !hostAccountId) {
        warning = "Zaakceptowano, ale nie udało się otworzyć czatu. Odśwież stronę i spróbuj ponownie.";
      } else {
        const conversationId = crypto.randomUUID();
        const { error: convError } = await supabase
          .from("conversations")
          .insert({ id: conversationId, kind: "lodging", lodging_host_request_id: requestId });
        if (convError) {
          warning = "Zaakceptowano, ale nie udało się otworzyć czatu. Odśwież stronę i spróbuj ponownie.";
        } else {
          const { error: participantsError } = await supabase.from("conversation_participants").insert([
            { conversation_id: conversationId, account_id: hostAccountId },
            { conversation_id: conversationId, account_id: requesterAccountId },
          ]);
          if (participantsError) {
            warning = "Zaakceptowano, ale nie udało się otworzyć czatu. Odśwież stronę i spróbuj ponownie.";
          }
        }
      }
    }
    return { data, warning };
  };

  return { incoming, outgoing, loading, error, requestToJoin, withdraw, respond, refresh };
}
