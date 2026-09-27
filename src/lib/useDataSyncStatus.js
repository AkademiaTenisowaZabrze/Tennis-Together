import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase.js";

// Kiedy serwer (GitHub Actions, raz dziennie) ostatnio zaktualizował dane
// turniejów — patrz 0030_data_sync_status.sql. Pokazywane jako baner na
// Start, żeby użytkownik wiedział, że dane są świeże, zamiast zgadywać.
export function useDataSyncStatus() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("data_sync_status").select("key, last_synced_at");
    if (!error) setRows(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Najstarsza z synchronizacji, którymi się przejmujemy — jeśli jedno źródło
  // nie odświeżyło się od dawna, to właśnie to chcemy pokazać, nie najświeższe.
  const oldest = rows.reduce((acc, r) => {
    const t = new Date(r.last_synced_at).getTime();
    return !acc || t < acc ? t : acc;
  }, null);

  return { lastSyncedAt: oldest ? new Date(oldest) : null, loading, refresh };
}
