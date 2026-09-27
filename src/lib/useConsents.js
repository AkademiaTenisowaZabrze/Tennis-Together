import { useEffect, useState } from "react";
import { supabase } from "./supabase.js";

// Zgody udzielone przez to konto (tabela `consents`) — RLS (0024_fix_missing_rls.sql)
// i tak pokazuje tylko własne (given_by_account_id = auth.uid()), filtr .eq()
// niżej jest dla czytelności zapytania. Zastępuje MOCK_PARENT_PROFILE.consents
// w ProfilePage.jsx.
export function useConsents(accountId) {
  const [consents, setConsents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) {
      setConsents([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase
      .from("consents")
      .select("id, consent_type, granted, created_at, players(first_name)")
      .eq("given_by_account_id", accountId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error) setConsents(data ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return { consents, loading };
}
