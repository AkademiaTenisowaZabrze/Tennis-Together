import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./components/Icon.jsx";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import StartPage from "./pages/StartPage.jsx";
import TournamentsPage from "./pages/TournamentsPage.jsx";
import RidesPage from "./pages/RidesPage.jsx";
import LodgingPage from "./pages/LodgingPage.jsx";
import TripsPage from "./pages/TripsPage.jsx";
import MessagesPage from "./pages/MessagesPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import ClubPage from "./pages/ClubPage.jsx";
import TripsHub from "./pages/TripsHub.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import SetPasswordPage from "./pages/SetPasswordPage.jsx";
import { useAuth } from "./lib/AuthContext.jsx";
import { useTheme } from "./lib/theme.js";
import { initBackButton } from "./lib/layers.js";
import { Drawer, FloatingTabs, TopActions } from "./components/Shell.jsx";
import { usePushNotifications } from "./lib/usePushNotifications.js";

export default function App() {
  const { mode, setMode } = useTheme();
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
        <Icon name="lock" size={44} style={{ color: "var(--accent-ink)" }} />
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

  return <AppShell account={account} mode={mode} setMode={setMode} signOut={signOut} />;
}

// Szkielet po zalogowaniu (STANDARD DESIGNU v1): treść na całym ekranie, przycisk menu, akcja "＋"
// i pływający pasek 4 zakładek; reszta w szufladzie. Przycisk "wstecz" zamyka najpierw nakładki.
function AppShell({ account, mode, setMode, signOut }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  // przycisk "wstecz" w Androidzie: nakładki, potem Start, potem zamknięcie aplikacji
  useEffect(() => initBackButton({ getPath: () => pathRef.current, goHome: () => navigate("/") }), [navigate]);

  return (
    <>
      <TopActions onMenu={() => setDrawerOpen(true)} menuOpen={drawerOpen} />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<StartPage />} />
          <Route path="/turnieje" element={<TournamentsPage />} />
          <Route path="/wyjazdy" element={<TripsHub />}>
            <Route index element={<Navigate to="przejazdy" replace />} />
            <Route path="przejazdy" element={<RidesPage />} />
            <Route path="noclegi" element={<LodgingPage />} />
            <Route path="moje" element={<TripsPage />} />
          </Route>
          <Route path="/przejazdy" element={<Navigate to="/wyjazdy/przejazdy" replace />} />
          <Route path="/noclegi" element={<Navigate to="/wyjazdy/noclegi" replace />} />
          <Route path="/moje-wyjazdy" element={<Navigate to="/wyjazdy/moje" replace />} />
          <Route path="/wiadomosci" element={<MessagesPage />} />
          <Route path="/profil" element={<ProfilePage />} />
          <Route path="/klub" element={<ClubPage />} />
        </Routes>
      </main>
      <FloatingTabs />
      <Drawer open={drawerOpen} onClose={closeDrawer} account={account} mode={mode} setMode={setMode} signOut={signOut} />
    </>
  );
}
