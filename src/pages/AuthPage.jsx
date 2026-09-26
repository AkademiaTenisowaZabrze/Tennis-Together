import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../lib/AuthContext.jsx";
import ErrorBox from "../components/ErrorBox.jsx";
import { inputStyle, labelStyle } from "../components/formStyles.js";
import { APP_VERSION } from "../lib/appVersion.js";
import PasswordInput from "../components/PasswordInput.jsx";

const SIGNUP_LIMIT_PER_HOUR = 2;

// Ile prób rejestracji zapisano w ostatniej godzinie — patrz
// 0023_signup_attempts.sql. Tylko przybliżenie prawdziwego limitu
// wysyłki maili Supabase, ale wystarczające do ostrzeżenia w UI.
async function countRecentSignupAttempts() {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("signup_attempts")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  return count ?? 0;
}

const ROLES = [
  { value: "parent", label: "Rodzic" },
  { value: "guardian", label: "Opiekun" },
  { value: "coach", label: "Trener / klub" },
];

export default function AuthPage() {
  const [mode, setMode] = useState("login"); // "login" | "register"

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Ekran logowania renderuje się poza szkieletem App.jsx (bez
        // sesji nie ma jeszcze nagłówka/nav), więc sam potrzebuje marginesu
        // na pasek stanu/gestów Androida — patrz komentarze w App.jsx.
        padding: "calc(16px + env(safe-area-inset-top, 0px)) 16px calc(16px + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 32, margin: 0 }}>🎾</p>
          <h1 style={{ margin: "4px 0 0" }}>Tennis Together</h1>
          <p style={{ margin: "4px 0 0", color: "var(--color-text-muted)", fontSize: 13 }}>
            Wspólne wyjazdy na turnieje tenisowe
          </p>
        </div>

        <div className="segmented">
          <button className={mode === "login" ? "is-active" : ""} onClick={() => setMode("login")}>
            Mam już konto
          </button>
          <button className={mode === "register" ? "is-active" : ""} onClick={() => setMode("register")}>
            Zakładam konto
          </button>
        </div>

        <div className="glass-card">{mode === "login" ? <LoginForm /> : <RegisterForm onDone={() => setMode("login")} />}</div>

        <p style={{ fontSize: 11, color: "var(--color-text-muted)", textAlign: "center" }}>
          Konto zakłada tylko dorosły (rodzic/opiekun/trener) — patrz PLAN.md.
          Regulamin i polityka prywatności są w przygotowaniu.
        </p>
        <p style={{ fontSize: 11, color: "var(--color-text-muted)", textAlign: "center", opacity: 0.6 }}>
          Wersja {APP_VERSION}
        </p>
      </div>
    </div>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(translateAuthError(error));
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    // Link z maila prowadzi do wersji webowej aplikacji, gdzie użytkownik
    // ustawia nowe hasło (SetPasswordPage). Adres musi być na liście
    // Redirect URLs w Supabase (wpis .../Tennis-Together/** go obejmuje).
    const siteUrl = import.meta.env.VITE_SITE_URL || "https://akademiatenisowazabrze.github.io/Tennis-Together";
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl}/app/` });
    setBusy(false);
    if (error) {
      setError(translateAuthError(error));
      return;
    }
    setResetSent(true);
  };

  if (forgot && resetSent) {
    return (
      <div style={{ textAlign: "center", padding: "8px 0" }}>
        <p style={{ fontSize: 28, margin: "0 0 8px" }}>📬</p>
        <p style={{ margin: 0, fontWeight: 700 }}>Sprawdź swoją skrzynkę</p>
        <p style={{ margin: "8px 0 16px", fontSize: 13, color: "var(--color-text-muted)" }}>
          Jeśli konto z adresem {email} istnieje, wysłaliśmy na nie link do ustawienia nowego hasła.
        </p>
        <button className="btn-ghost" onClick={() => { setForgot(false); setResetSent(false); }}>
          Wróć do logowania
        </button>
      </div>
    );
  }

  if (forgot) {
    return (
      <form onSubmit={handleReset} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>
          Podaj e-mail konta, a wyślemy Ci link do ustawienia nowego hasła.
        </p>
        <div>
          <label style={labelStyle}>E-mail</label>
          <input style={inputStyle} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "Wysyłam…" : "Wyślij link"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => { setForgot(false); setError(null); }}>
          Wróć do logowania
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <label style={labelStyle}>E-mail</label>
        <input style={inputStyle} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>Hasło</label>
        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button className="btn-primary" type="submit" disabled={busy}>
        {busy ? "Loguję…" : "Zaloguj się"}
      </button>
      <button
        type="button"
        onClick={() => { setForgot(true); setError(null); }}
        style={{ background: "transparent", border: "none", color: "var(--color-text-muted)", fontSize: 13, textDecoration: "underline", cursor: "pointer", padding: 4 }}
      >
        Nie pamiętasz hasła?
      </button>
    </form>
  );
}

function RegisterForm({ onDone }) {
  const { registerPendingProfile } = useAuth();
  const [role, setRole] = useState("parent");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmNotice, setConfirmNotice] = useState(false);
  const [attemptsThisHour, setAttemptsThisHour] = useState(null);

  useEffect(() => {
    let cancelled = false;
    countRecentSignupAttempts().then((n) => {
      if (!cancelled) setAttemptsThisHour(n);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Hasło musi mieć co najmniej 8 znaków.");
      return;
    }

    setBusy(true);
    // Log próby PRZED signUp — liczy się każda próba wysłania
    // formularza, niezależnie czy signUp się powiedzie (patrz komentarz
    // w 0023_signup_attempts.sql). Best-effort: brak awaryjnego
    // przerywania rejestracji, jeśli akurat ten zapis się nie uda.
    supabase
      .from("signup_attempts")
      .insert({})
      .then(() => setAttemptsThisHour((n) => (n ?? 0) + 1));

    // Zapisujemy dane profilu PRZED signUp — jeśli projekt wymaga
    // potwierdzenia e-maila, sesja (i możliwość zapisu do `accounts`)
    // pojawi się dopiero po kliknięciu linku z maila, w zupełnie nowym
    // wczytaniu aplikacji. Patrz AuthContext.jsx.
    registerPendingProfile({ role, full_name: fullName });

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Bez tego link w mailu potwierdzającym wraca na cokolwiek jest
        // ustawione jako "Site URL" w panelu Supabase — u nas domyślny
        // placeholder (localhost), więc kliknięcie na telefonie/innym
        // komputerze kończyło się błędem. Strona niżej istnieje niezależnie
        // od tego, czy apka jest akurat zainstalowana czy nie (GitHub
        // Pages, ten sam mechanizm co docs/testerzy.html). UWAGA: ten
        // dokładny adres musi być wpisany w Supabase → Authentication →
        // URL Configuration → Redirect URLs, inaczej Supabase odrzuci
        // przekierowanie własnym, technicznym komunikatem błędu zanim
        // użytkownik w ogóle zobaczy tę stronę.
        emailRedirectTo: `${import.meta.env.VITE_SITE_URL || "https://pmesznik.github.io/Tennis-Together"}/potwierdz-email.html`,
        // Imię trafia do metadanych konta w Supabase Auth (nie tylko do
        // naszej tabeli `accounts`), żeby szablon maila potwierdzającego
        // mógł się zwrócić po imieniu przez {{ .Data.full_name }} — patrz
        // docs/szablon-maila-potwierdzenie.html.
        data: { full_name: fullName.trim() },
      },
    });
    setBusy(false);

    if (error) {
      setError(translateAuthError(error));
      return;
    }

    if (!data.session) {
      // Confirm email włączone w ustawieniach projektu — trzeba kliknąć link.
      setConfirmNotice(true);
    }
    // Jeśli data.session istnieje, AuthContext sam złapie zmianę stanu i
    // utworzy wiersz w accounts — użytkownik od razu zobaczy główną appkę.
  };

  if (confirmNotice) {
    return (
      <div style={{ textAlign: "center", padding: "8px 0" }}>
        <p style={{ fontSize: 28, margin: "0 0 8px" }}>📬</p>
        <p style={{ margin: 0, fontWeight: 700 }}>Sprawdź swoją skrzynkę</p>
        <p style={{ margin: "8px 0 16px", fontSize: 13, color: "var(--color-text-muted)" }}>
          Wysłaliśmy link potwierdzający na {email}. Kliknij go, żeby dokończyć zakładanie konta.
        </p>
        <button className="btn-ghost" onClick={onDone}>
          Wróć do logowania
        </button>
      </div>
    );
  }

  const limitReached = attemptsThisHour != null && attemptsThisHour >= SIGNUP_LIMIT_PER_HOUR;

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          fontSize: 12.5,
          color: "var(--color-text-muted)",
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-card-border)",
          borderRadius: 12,
          padding: "10px 12px",
        }}
      >
        🧪 Wczesna wersja beta — z powodu technicznego ograniczenia wysyłki maili można zakładać maks.{" "}
        <strong>{SIGNUP_LIMIT_PER_HOUR} konta na godzinę</strong> (dla całej aplikacji, nie tylko Ciebie).
        {attemptsThisHour != null && (
          <>
            {" "}
            W tej godzinie: <strong>{Math.min(attemptsThisHour, SIGNUP_LIMIT_PER_HOUR)}/{SIGNUP_LIMIT_PER_HOUR}</strong>.
          </>
        )}{" "}
        Jeśli nie dostaniesz maila potwierdzającego, odczekaj godzinę i spróbuj ponownie.
      </div>
      <div>
        <label style={labelStyle}>Kim jesteś?</label>
        <div className="chip-row">
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              className={`chip ${role === r.value ? "is-active" : ""}`}
              onClick={() => setRole(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label style={labelStyle}>Imię i nazwisko</label>
        <input style={inputStyle} required value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>E-mail</label>
        <input style={inputStyle} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>Hasło (min. 8 znaków)</label>
        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} />
      </div>
      {limitReached && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-secondary)" }}>
          Limit rejestracji na tę godzinę prawdopodobnie wyczerpany — możesz spróbować, ale mail może nie dojść.
        </p>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      <button className="btn-primary" type="submit" disabled={busy}>
        {busy ? "Zakładam konto…" : "Załóż konto"}
      </button>
    </form>
  );
}

function translateAuthError(error) {
  const msg = error.message || "";
  if (msg.toLowerCase().includes("rate limit"))
    return `Osiągnięto limit ${SIGNUP_LIMIT_PER_HOUR} rejestracji na godzinę (wczesna wersja beta) — spróbuj ponownie za godzinę.`;
  if (msg.includes("Invalid login credentials")) return "Błędny e-mail lub hasło.";
  if (msg.includes("Email not confirmed"))
    return "Ten e-mail nie jest jeszcze potwierdzony — sprawdź skrzynkę i kliknij link, który wysłaliśmy przy rejestracji.";
  if (msg.includes("User already registered")) return "Konto z tym e-mailem już istnieje — zaloguj się.";
  if (msg.includes("Password should be at least")) return "Hasło jest za krótkie.";
  if (msg.includes("Unable to validate email")) return "Nieprawidłowy adres e-mail.";
  return msg || "Coś poszło nie tak. Spróbuj ponownie.";
}
