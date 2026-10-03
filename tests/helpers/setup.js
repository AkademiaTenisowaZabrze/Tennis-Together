// Wspólne ustawienia testów. Atrapa zmiennych Vite, żeby moduły aplikacji
// (src/lib/supabase.js) nie ostrzegały o braku konfiguracji.
import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.stubEnv("VITE_SUPABASE_URL", "http://localhost:54321");
vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");

// jsdom nie ma tych API, a aplikacja z nich korzysta (powiadomienia, układ).
if (typeof window !== "undefined") {
  window.scrollTo = window.scrollTo || (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }
}
