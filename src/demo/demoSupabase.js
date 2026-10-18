// TRYB DEMO (vite build --mode demo): aplikacja bez połączenia z prawdziwą bazą.
// Zamiast klienta Supabase działa atrapa z testów, z wymyślonym użytkownikiem ("Test Rodzic")
// i przykładowymi danymi, od razu zalogowanym. Służy do oglądania i testowania wyglądu
// (emulator, przeglądarka) bez zakładania kont na produkcji. Patrz vite.config.js.
import { supabase as fakeSupabase, reset } from "../../tests/helpers/fakeSupabase.js";

reset();

export const supabase = fakeSupabase;
export const DEMO_MODE = true;
