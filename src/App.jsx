import { useEffect, useState } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import StartPage from "./pages/StartPage.jsx";
import TournamentsPage from "./pages/TournamentsPage.jsx";
import RidesPage from "./pages/RidesPage.jsx";
import LodgingPage from "./pages/LodgingPage.jsx";
import TripsPage from "./pages/TripsPage.jsx";
import MessagesPage from "./pages/MessagesPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import ClubPage from "./pages/ClubPage.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import SetPasswordPage from "./pages/SetPasswordPage.jsx";
import { useAuth } from "./lib/AuthContext.jsx";
import { usePushNotifications } from "./lib/usePushNotifications.js";

// Szkielet głównego menu z dokumentu założeń (Start / Turnieje / Przejazdy /
// Noclegi / Moje wyjazdy / Wiadomości / Profil). Każda zakładka na razie to
// placeholder — wypełniamy je w kolejnych etapach zgodnie z PLAN.md.
const TABS = [
  { to: "/", label: "Start", end: true },
  { to: "/turnieje", label: "Turnieje" },
  { to: "/przejazdy", label: "Przejazdy" },
  { to: "/noclegi", label: "Noclegi" },
  { to: "/moje-wyjazdy", label: "Moje wyjazdy" },
  { to: "/wiadomosci", label: "Wiadomości" },
  { to: "/profil", label: "Profil" },
];

// Zakładka "Klub" dochodzi tylko dla roli `coach` (PLAN.md, panel
// trenera/klubu) — reszcie użytkowników niepotrzebnie zaśmiecałaby menu.
const COACH_TAB = { to: "/klub", label: "Klub" };

const THEME_STORAGE_KEY = "tennis-together-theme";

// Dark Mode Premium jest domyślny z dokumentu UX (docs/UX_Branding_Tennis_Together.docx) —
// Light Mode jest świadomym wyborem użytkownika (np. pełne słońce na korcie),
// nie wynika z ustawień systemowych telefonu.
function useTheme() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem(THEME_STORAGE_KEY) || "dark"
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return [theme, setTheme];
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const { session, loading, account, signOut, recovery } = useAuth();
  // Rejestracja do powiadomień push — hook sam pilnuje, że nie robi nic
  // bez zalogowanego konta i poza natywną apką (przeglądarka/PWA).
  usePushNotifications(account?.id);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-muted)",
        }}
      >
        Wczytywanie…
      </div>
    );
  }

  if (!session) {
    return <AuthPage />;
  }

  if (recovery) {
    return <SetPasswordPage />;
  }

  // Zdalny wyłącznik konta (patrz 0016_account_suspension.sql) — RLS i tak
  // blokuje zawieszonemu kontu każdy zapis/odczyt poza własnym wierszem w
  // `accounts`, ale bez tego ekranu użytkownik zobaczyłby tylko serię
  // niezrozumiałych błędów RLS zamiast jasnej informacji, co się stało.
  if (account?.status === "suspended") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 40 }}>🔒</div>
        <h1 style={{ margin: 0 }}>Konto zawieszone</h1>
        <p style={{ margin: 0, color: "var(--color-text-muted)", maxWidth: 360 }}>
          Dostęp do tego konta został tymczasowo zablokowany — np. z powodu wygasłej płatności.
          Skontaktuj się z administratorem, żeby go przywrócić.
        </p>
        <button className="btn-ghost" onClick={signOut} style={{ marginTop: 8 }}>
          Wyloguj
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", width: "100%", maxWidth: 720, margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          // env(safe-area-inset-top) + viewport-fit=cover (index.html) —
          // bez tego pasek stanu na Androidzie zasłania nagłówek (patrz
          // ten sam problem i rozwiązanie w projekcie PZT, App.jsx).
          padding: "16px 16px 16px 16px",
          paddingTop: "calc(16px + env(safe-area-inset-top, 0px))",
          borderBottom: "1px solid var(--color-card-border)",
        }}
      >
        <strong style={{ fontFamily: "var(--font-heading)" }}>🎾 Tennis Together</strong>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Przełącz tryb jasny/ciemny"
          style={{
            background: "transparent",
            border: "1px solid var(--color-card-border)",
            color: "var(--color-text)",
            borderRadius: 999,
            padding: "6px 12px",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          {theme === "dark" ? "☀️ Jasny" : "🌙 Ciemny"}
        </button>
      </header>

      <main style={{ flex: 1, padding: "16px" }}>
        <Routes>
          <Route path="/" element={<StartPage />} />
          <Route path="/turnieje" element={<TournamentsPage />} />
          <Route path="/przejazdy" element={<RidesPage />} />
          <Route path="/noclegi" element={<LodgingPage />} />
          <Route path="/moje-wyjazdy" element={<TripsPage />} />
          <Route path="/wiadomosci" element={<MessagesPage />} />
          <Route path="/profil" element={<ProfilePage />} />
          <Route path="/klub" element={<ClubPage />} />
        </Routes>
      </main>

      <nav
        style={{
          display: "flex",
          overflowX: "auto",
          borderTop: "1px solid var(--color-card-border)",
          background: "var(--color-bg-elevated)",
          position: "sticky",
          bottom: 0,
          // Pasek nawigacji Androida (gesty/przyciski) inaczej zasłania
          // zakładki — patrz komentarz przy nagłówku wyżej.
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {(account?.role === "coach" ? [...TABS, COACH_TAB] : TABS).map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            style={({ isActive }) => ({
              flex: "1 0 auto",
              padding: "10px 12px",
              textAlign: "center",
              textDecoration: "none",
              fontSize: 13,
              whiteSpace: "nowrap",
              color: isActive ? "var(--color-primary)" : "var(--color-text-muted)",
              fontWeight: isActive ? 700 : 400,
              borderTop: isActive ? "2px solid var(--color-primary)" : "2px solid transparent",
            })}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
