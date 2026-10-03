import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase.js";

// Oferty noclegowe — widoczne dla WSZYSTKICH zalogowanych (jak w
// useRides.js), zapis tylko dla właściciela powiązanego wyjazdu. RLS w
// supabase/migrations/0006_lodging_rls.sql.
const SELECT_WITH_TRIP =
  "*, trips(tournament_id, created_by_account_id, departure_city, tournaments(name, starts_on, category), players:player_cards(first_name))";

export function useLodgingOffers() {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("lodging_offers")
      .select(SELECT_WITH_TRIP)
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

  const createOffer = async ({ tripId, kind, placeName, freeSpots, budgetPerNight, notes }) => {
    const { data, error } = await supabase
      .from("lodging_offers")
      .insert({
        trip_id: tripId,
        kind,
        place_name: placeName || null,
        free_spots: freeSpots || null,
        budget_per_night: budgetPerNight || null,
        notes: notes || null,
      })
      .select(SELECT_WITH_TRIP)
      .single();

    if (error) return { error };
    setOffers((prev) => [data, ...prev]);
    return { data };
  };

  return { offers, loading, error, createOffer, refresh };
}
