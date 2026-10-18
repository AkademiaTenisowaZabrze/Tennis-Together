import { useCallback, useEffect, useState } from "react";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";

// Motyw aplikacji: "auto" (według telefonu, domyślnie), "light" albo "dark".
// Tokeny kolorów w src/styles/tokens.css reagują na prefers-color-scheme, a ręczny wybór
// ustawia <html data-theme>. Klucz _v2: stary klucz zapisywał "dark" automatycznie, więc
// nie wolno go traktować jak świadomego wyboru użytkownika.
export const THEME_KEY = "tennis-together-theme-v2";
export const THEME_MODES = ["auto", "light", "dark"];
export const THEME_LABELS = { auto: "Auto", light: "Jasny", dark: "Ciemny" };

export function readThemeMode() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return THEME_MODES.includes(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

export function applyThemeMode(mode) {
  const el = document.documentElement;
  if (mode === "light" || mode === "dark") el.dataset.theme = mode;
  else delete el.dataset.theme;
}

export function effectiveTheme(mode) {
  if (mode === "light" || mode === "dark") return mode;
  const dark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return dark ? "dark" : "light";
}

// Ikony paska stanu i paska gestów mają kontrastować z tłem APLIKACJI, a nie z motywem telefonu
// (inaczej przy ręcznie wybranym motywie godzina bywa ciemna na ciemnym tle).
async function syncSystemBars(theme) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await SystemBars.setStyle({ style: theme === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light });
  } catch {
    // starsze WebView/urządzenia: zostaje domyślny styl systemu
  }
}

export function useTheme() {
  const [mode, setModeState] = useState(readThemeMode);
  const [theme, setTheme] = useState(() => effectiveTheme(readThemeMode()));

  useEffect(() => {
    applyThemeMode(mode);
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      // tryb prywatny: wybór działa do końca sesji
    }
    const update = () => {
      const t = effectiveTheme(mode);
      setTheme(t);
      syncSystemBars(t);
    };
    update();
    if (mode !== "auto" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, [mode]);

  const setMode = useCallback((m) => setModeState(THEME_MODES.includes(m) ? m : "auto"), []);
  return { mode, theme, setMode };
}
