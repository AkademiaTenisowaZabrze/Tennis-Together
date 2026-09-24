import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Tennis Together — konfiguracja Vite.
// PWA działa równolegle z Androidem od startu (patrz PLAN.md), dlatego
// manifest i ikony są tu skonfigurowane już teraz — ikony-placeholder
// trzeba podmienić, gdy będzie gotowa identyfikacja wizualna marki.
// VITE_BASE ustawia workflow wersji webowej na GitHub Pages (podkatalog
// /Tennis-Together/app/); APK i dev zostają na "/".
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Rejestrację robimy ręcznie w src/main.jsx, TYLKO poza natywną apką
      // (Capacitor.isNativePlatform()). Bez tego Service Worker próbowałby
      // działać też wewnątrz WebView na Androidzie, gdzie tylko szkodzi —
      // dostęp offline appka i tak ma wprost z plików w APK. Dokładnie ten
      // problem (stary SW przechwytujący żądania po aktualizacji) uderzył
      // w projekt PZT Rankingi i wymagał naprawy po stronie natywnej
      // (czyszczenie danych WebView) — tu zapobiegamy mu od początku.
      injectRegister: null,
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "Tennis Together",
        short_name: "Tennis Together",
        description: "Wspólne wyjazdy na turnieje tenisowe — przejazdy, noclegi, grupy.",
        theme_color: "#0d131e",
        background_color: "#0d131e",
        display: "standalone",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // Dane są w Supabase (sieciowe), więc cache trzymamy krótko —
        // priorytet ma świeżość (kto jedzie/ma miejsce zmienia się często).
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-cache",
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 3100,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
