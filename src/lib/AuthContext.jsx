import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase.js";

const AuthContext = createContext(null);

// Klucz roboczy do przekazania danych z formularza rejestracji do momentu,
// aż Supabase potwierdzi konto (jeśli w Auth → Providers → Email jest
// włączone "Confirm email", sesja pojawia się dopiero PO kliknięciu linku
// z maila, czyli w innej "wizycie" niż wypełnianie formularza). Bez tego
// nie mielibyśmy skąd wziąć roli/imienia przy tworzeniu wiersza w `accounts`.
const PENDING_PROFILE_KEY = "tennis-together-pending-profile";
const PUSH_TOKEN_KEY = "tennis-together-push-token";

export function AuthProvider({ children }) {
  // undefined = jeszcze nie wiadomo (trwa sprawdzanie), null = wylogowany
  const [session, setSession] = useState(undefined);
  const [account, setAccount] = useState(null);
  const [accountLoading, setAccountLoading] = useState(false);
  // Id użytkownika, dla którego próba wczytania konta już się zakończyła (udana
  // lub nie). Dzięki temu między "jest sesja" a "zaczęło się wczytywanie konta"
  // nie mignie pełny ekran aplikacji bez konta.
  const [checkedFor, setCheckedFor] = useState(null);
  // true po kliknięciu linku "resetuj hasło" z maila - patrz SetPasswordPage.jsx
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadAccount = useCallback(async (userId) => {
    setAccountLoading(true);
    const { data, error } = await supabase
      .from("accounts")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("[auth] Nie udało się wczytać konta:", error.message);
      setAccountLoading(false);
      return;
    }

    if (data) {
      setAccount(data);
      setAccountLoading(false);
      return;
    }

    // Brak wiersza w `accounts` mimo zalogowania — pierwszy raz po
    // potwierdzeniu maila. Dokładamy go teraz, z danych zapisanych przy
    // rejestracji (albo minimalnym fallbackiem, żeby nikt nie utknął bez
    // profilu).
    let pending = null;
    try {
      const raw = localStorage.getItem(PENDING_PROFILE_KEY);
      if (raw) pending = JSON.parse(raw);
    } catch {
      // localStorage może nie działać (tryb prywatny) — jedziemy na fallbacku
    }

    const { data: created, error: insertError } = await supabase
      .from("accounts")
      .insert({
        id: userId,
        role: pending?.role ?? "parent",
        full_name: pending?.full_name ?? "Nowy użytkownik",
        // zgoda na regulamin i politykę prywatności z formularza rejestracji (0051)
        ...(pending?.terms_accepted_at ? { terms_accepted_at: pending.terms_accepted_at, terms_version: pending.terms_version ?? null } : {}),
      })
      .select()
      .single();

    if (insertError) {
      console.error("[auth] Nie udało się utworzyć wiersza w accounts:", insertError.message);
    } else {
      setAccount(created);
      localStorage.removeItem(PENDING_PROFILE_KEY);
    }
    setAccountLoading(false);
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (session === null) {
      setAccount(null);
      setCheckedFor(null);
      return;
    }
    let cancelled = false;
    loadAccount(session.user.id).finally(() => {
      if (!cancelled) setCheckedFor(session.user.id);
    });
    return () => {
      cancelled = true;
    };
  }, [session, loadAccount]);

  const registerPendingProfile = (profile) => {
    try {
      localStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify(profile));
    } catch {
      // trudno — jeśli localStorage nie działa, zadziała fallback w loadAccount
    }
  };

  // Przy wylogowaniu usuwamy token powiadomień TEGO urządzenia, żeby na
  // wspólnym telefonie/komputerze powiadomienia poprzedniego konta nie
  // trafiały do kolejnej osoby (audyt 2026-09-16). Token zapisuje
  // usePushNotifications / useWebPush pod kluczem PUSH_TOKEN_KEY.
  const signOut = async () => {
    try {
      const token = localStorage.getItem(PUSH_TOKEN_KEY);
      if (token && session?.user?.id) {
        await supabase.from("device_tokens").delete().eq("account_id", session.user.id).eq("token", token);
        localStorage.removeItem(PUSH_TOKEN_KEY);
      }
    } catch {
      // wylogowanie ma się udać nawet wtedy, gdy sprzątanie tokenu zawiedzie
    }
    return supabase.auth.signOut();
  };

  // Usunięcie konta i wszystkich danych (RODO art. 17). Plik zdjęcia profilowego usuwamy tu, bo SQL nie
  // czyści Storage; resztę (zawodnicy, wyjazdy, oferty, wiadomości, zgody) robi funkcja bazy
  // delete_my_account() kaskadowo (0048). Po sukcesie sesja i tak przestaje być ważna.
  const deleteAccount = async () => {
    const uid = session?.user?.id;
    if (!uid) return { error: new Error("Brak zalogowanego konta.") };
    try {
      const bucket = supabase.storage.from("avatars");
      const { data: files } = await bucket.list(uid);
      if (files?.length) await bucket.remove(files.map((f) => `${uid}/${f.name}`));
    } catch {
      // zdjęcie jest dodatkiem: jego błąd nie może blokować usunięcia konta
    }
    const { error } = await supabase.rpc("delete_my_account");
    if (error) return { error };
    try {
      localStorage.removeItem(PUSH_TOKEN_KEY);
      localStorage.removeItem(PENDING_PROFILE_KEY);
    } catch {
      // bez znaczenia
    }
    await supabase.auth.signOut();
    return {};
  };

  const updateAccount = async (fields) => {
    if (!account) return { error: new Error("Brak zalogowanego konta.") };
    const { data, error } = await supabase
      .from("accounts")
      .update(fields)
      .eq("id", account.id)
      .select()
      .single();
    if (error) return { error };
    setAccount(data);
    return { data };
  };

  const value = {
    session,
    account,
    user: session?.user ?? null,
    loading: session === undefined || (session !== null && !account && checkedFor !== session.user.id),
    recovery,
    finishRecovery: () => setRecovery(false),
    registerPendingProfile,
    signOut,
    deleteAccount,
    updateAccount,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() musi być użyte wewnątrz <AuthProvider>");
  return ctx;
}
