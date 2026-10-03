import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Konfiguracja testów (osobna od vite.config.js, żeby testy nie ładowały PWA).
// Uruchamianie: npm test  (patrz tests/README.md)
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.{js,mjs,jsx}"],
    globalSetup: ["tests/db/globalSetup.mjs"],
    environment: "node",
    environmentMatchGlobs: [["tests/ui/**", "jsdom"]],
    pool: "forks",
    testTimeout: 30000,
    hookTimeout: 120000,
    setupFiles: ["tests/helpers/setup.js"],
  },
});
