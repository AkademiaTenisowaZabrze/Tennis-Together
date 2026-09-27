import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase.js";

// Zawodnicy z oficjalnej listy startowej PZT (po selekcji, patrz
// 0027_pzt_tournament_entries.sql), którzy są już użytkownikami Tennis
// Together i mają WŁASNY wyjazd na TEN SAM turniej — czyli ludzie, których
// realnie da się poprosić o podwiezienie. Dopasowanie robi
// find_pzt_tournament_matches() (SECURITY DEFINER), bo zwykłe RLS na
// `players` pokazuje tylko własnych zawodników.
export function useTournamentMatches(tournamentId) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!tournamentId) {
      setMatches([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("find_pzt_tournament_matches", {
      p_tournament_id: tournamentId,
    });
    if (error) setError(error.message);
    else {
      setError(null);
      setMatches(data ?? []);
    }
    setLoading(false);
  }, [tournamentId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { matches, loading, error, refresh };
}
