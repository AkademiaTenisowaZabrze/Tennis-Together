import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase.js";

// Rozmowy, których jestem uczestnikiem. RLS (0008_messages_rls.sql) i tak
// pokazuje tylko moje — tu dodatkowo wyciągamy "drugą stronę" (imię
// rozmówcy) do wyświetlenia na liście.
export function useConversations(accountId) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!accountId) {
      setConversations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("conversations")
      .select(
        `id, kind, created_at,
         ride_offers(trips(departure_city, tournaments(name))),
         lodging_offers(trips(departure_city, tournaments(name))),
         ride_pings(tournaments(name)),
         lodging_host_requests(lodging_host_offers(tournaments(name))),
         conversation_participants(account_id, accounts(full_name))`
      )
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    const withOther = (data ?? []).map((c) => {
      const other = c.conversation_participants?.find((p) => p.account_id !== accountId);
      const tournamentName =
        c.ride_offers?.trips?.tournaments?.name ??
        c.lodging_offers?.trips?.tournaments?.name ??
        c.ride_pings?.tournaments?.name ??
        c.lodging_host_requests?.lodging_host_offers?.tournaments?.name ??
        null;
      return {
        ...c,
        otherName: other?.accounts?.full_name ?? "Rozmówca",
        title: tournamentName ?? (c.kind === "ride" ? "Przejazd" : c.kind === "lodging" ? "Nocleg" : "Rozmowa"),
      };
    });

    setError(null);
    setConversations(withOther);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { conversations, loading, error, refresh };
}
