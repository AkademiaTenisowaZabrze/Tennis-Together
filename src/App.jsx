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
import atzLogo from "./assets/atz-logo.png";
import pztLogo from "./assets/pzt-logo.png";

// Szkielet głównego menu z dokumentu założeń (Start / Turnieje / Przejazdy /
// Noclegi / Moje wyjazdy / Wiadomości / Profil). Każda zakładka na razie to
// placeholder — wypełniamy je w kolejnych etapach zgodnie z PLAN.md.
const TABS = [
  { to: "/", label: "Start", icon: "home", end: true },
  { to: "/turnieje", label: "Turnieje", icon: "trophy" },
  { to: "/przejazdy", label: "Przejazdy", icon: "car" },
  { to: "/noclegi", label: "Noclegi", icon: "bed" },
  { to: "/moje-wyjazdy", label: "Moje wyjazdy", icon: "route" },
  { to: "/wiadomosci", label: "Wiadomości", icon: "chat" },
  { to: "/profil", label: "Profil", icon: "user" },
];

// Ikony zakładek (linie 24x24, kolor dziedziczony z tekstu zakładki).
const ICON_PATHS = {
  home: <><path d="M3 11l9-8 9 8" /><path d="M5 10v10h5v-6h4v6h5V10" /></>,
  trophy: <><path d="M8 21h8M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0V4z" /><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" /></>,
  car: <><path d="M5 16l1.5-5a2 2 0 0 1 1.9-1.4h7.2a2 2 0 0 1 1.9 1.4L19 16" /><rect x="3" y="16" width="18" height="4" rx="1.5" /><circle cx="7.5" cy="18" r="0.6" /><circle cx="16.5" cy="18" r="0.6" /></>,
  bed: <><path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6" /><circle cx="7" cy="11" r="1.6" /></>,
  route: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6" /></>,
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2 20a7 7 0 0 1 14 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2A7 7 0 0 1 22 20" /></>,
};

function TabIcon({ name }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}

// Zakładka "Klub" dochodzi tylko dla roli `coach` (PLAN.md, panel
// trenera/klubu) — reszcie użytkowników niepotrzebnie zaśmiecałaby menu.
const COACH_TAB = { to: "/klub", label: "Klub", icon: "users" };

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

export function BottomNav({ account }) {
  return (
  <nav
    style={{
      display: "flex",
      gap: 8,
      overflowX: "auto",
      padding: "8px 10px",
      borderTop: "1px solid var(--color-card-border)",
      background: "var(--color-bg-elevated)",
      position: "sticky",
      bottom: 0,
      // Pasek nawigacji Androida (gesty/przyciski) inaczej zasłania
      // zakładki - patrz komentarz przy nagłówku wyżej.
      paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
    }}
  >
    {(account?.role === "coach" ? [...TABS, COACH_TAB] : TABS).map((tab) => (
      <NavLink
        key={tab.to}
        to={tab.to}
        end={tab.end}
        style={({ isActive }) => ({
          flex: "1 0 auto",
          minWidth: 68,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 3,
          padding: "8px 10px",
          borderRadius: 14,
          textDecoration: "none",
          fontSize: 11,
          whiteSpace: "nowrap",
          color: isActive ? "var(--color-primary)" : "var(--color-text-muted)",
          fontWeight: isActive ? 700 : 500,
          background: isActive
            ? "color-mix(in srgb, var(--color-primary) 14%, transparent)"
            : "color-mix(in srgb, var(--color-text) 5%, transparent)",
          border: isActive ? "1px solid var(--color-primary)" : "1px solid var(--color-card-border)",
        })}
      >
        <TabIcon name={tab.icon} />
        {tab.label}
      </NavLink>
    ))}
  </nav>
  );
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src={atzLogo} alt="Akademia Tenisowa Zabrze" style={{ height: 28, width: "auto" }} />
          <img src={pztLogo} alt="Polski Związek Tenisowy" style={{ height: 28, width: "auto" }} />
          <strong style={{ fontFamily: "var(--font-heading)" }}>🎾 Tennis Together</strong>
        </div>
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

      <BottomNav account={account} />
    </div>
  );
}
