import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./lib/AuthContext.jsx";
import "./index.css";

// Powrót ze strony docs/404.html: adres /app/turnieje trafia tu jako
// /app/?/turnieje (GitHub Pages nie zna tras SPA). Przywracamy prawdziwy adres
// zanim wystartuje router.
(function restoreSpaPath() {
  const q = window.location.search;
  if (!q.startsWith("?/")) return;
  const [path, ...rest] = q.slice(2).split("&").map((s) => s.replace(/~and~/g, "&"));
  const search = rest.length ? "?" + rest.join("&") : "";
  window.history.replaceState(null, "", import.meta.env.BASE_URL + path + search + window.location.hash);
})();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);

// Service Worker (offline/PWA) tylko dla wersji webowej — w Capacitorze
// (isNativePlatform) go NIE rejestrujemy, bo tylko duplikuje i psuje dostęp
// offline, który apka i tak ma wprost z plików w APK. Ten sam wzorzec co
// w projekcie PZT Rankingi (src/main.jsx) — tam brak tego warunku
// spowodował, że stary Service Worker przechwytywał żądania po każdej
// aktualizacji APK i serwował nieaktualne pliki.
if ("serviceWorker" in navigator && !window.Capacitor?.isNativePlatform?.()) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
  });
}
