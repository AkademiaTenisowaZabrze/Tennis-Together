import { useEffect, useState } from "react";
import { supabase } from "./supabase.js";

// Stan załatwienia transportu/noclegu per wyjazd — funkcja trip_arrangements()
// z 0035_trip_arrangements.sql (własne wyjazdy + wyjazdy zawodników klubu dla
// trenera). Zwraca Map: trip_id -> { ride, lodging }, gdzie wartość to
// 'arranged' | 'offering' | 'pending' | 'none'. Jeśli funkcji jeszcze nie ma
// w bazie albo zapytanie padnie, mapa jest pusta, a UI pokazuje "brak danych"
// zamiast zgadywać.
export function useTripArrangements(refreshKey) {
  const [byTrip, setByTrip] = useState(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase.rpc("trip_arrangements").then(({ data, error }) => {
      if (cancelled) return;
      const map = new Map();
      if (!error) for (const r of data ?? []) map.set(r.trip_id, { ride: r.ride_status, lodging: r.lodging_status });
      setByTrip(map);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { byTrip, loading };
}

export const ARRANGEMENT_LABELS = {
  arranged: { text: "Załatwiony ✅", cls: "ok" },
  offering: { text: "Oferujesz miejsca", cls: "ok" },
  pending: { text: "Prośba czeka na odpowiedź", cls: "pending" },
  none: { text: "Jeszcze nic nie ustalone", cls: "muted" },
};
