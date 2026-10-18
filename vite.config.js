import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

// Tennis Together — konfiguracja Vite.
// PWA działa równolegle z Androidem od startu (patrz PLAN.md), dlatego
// manifest i ikony są tu skonfigurowane już teraz — ikony-placeholder
// trzeba podmienić, gdy będzie gotowa identyfikacja wizualna marki.
// VITE_BASE ustawia workflow wersji webowej na GitHub Pages (podkatalog
// /Tennis-Together/app/); APK i dev zostają na "/".
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE || "/",
  // Tryb demo (vite build --mode demo, patrz src/demo): klient Supabase zastępuje atrapa z przykładowymi danymi.
  resolve: {
    alias:
      mode === "demo"
        ? [{ find: /^(\.{1,2}\/)+(lib\/)?supabase\.js$/, replacement: path.resolve(__dirname, "src/demo/demoSupabase.js") }]
        : [],
  },
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
      includeAssets: ["icon-192.png", "icon-512.png", "favicon.svg", "favicon.ico", "apple-touch-icon.png"],
      manifest: {
        name: "Tennis Together",
        short_name: "Tennis Together",
        description: "Wspólne wyjazdy na turnieje tenisowe — przejazdy, noclegi, grupy.",
        theme_color: "#8ee3c8",
        background_color: "#f3f4f7",
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
}));
