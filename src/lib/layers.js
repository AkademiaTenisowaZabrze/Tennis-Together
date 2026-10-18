import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

// Stos nakładek (szuflada, okienko "＋", okna) wg STANDARDU DESIGNU, część 1 pkt 9 i 7.1-7.2:
// przycisk "wstecz" zamyka kolejno warstwy, a dopiero potem wraca do Startu albo zamyka aplikację.
//
// Każda otwarta nakładka dokłada wpis do historii przeglądarki (ten sam adres), więc "wstecz"
// w przeglądarce i w telefonie (Capacitor, patrz initBackButton) zamyka ją bez zmiany ekranu.
// Zamknięcie przyciskiem/tłem/Esc zdejmuje ten wpis historii sam (history.back()).
const stack = [];

export const layerCount = () => stack.length;

export function closeTopLayer() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  // Zamknięcie przez historię: popstate zamknie nakładkę i zdejmie wpis ze stosu.
  window.history.back();
  return true;
}

/**
 * Wykonuje `fn` (np. przejście na inny ekran) DOPIERO po zamknięciu nakładek. Bez tego przejście
 * i zdjęcie wpisu historii nakładki nałożyłyby się na siebie i "wstecz" trafiałoby na zły ekran.
 */
export function closeLayersThen(fn) {
  if (stack.length === 0) {
    fn();
    return;
  }
  const once = () => {
    window.removeEventListener("popstate", once);
    if (stack.length === 0) fn();
    else closeLayersThen(fn); // zagnieżdżone nakładki: zamykamy kolejne
  };
  window.addEventListener("popstate", once);
  window.history.back();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    const top = stack[stack.length - 1];
    const depth = window.history.state?.layer ?? 0;
    if (top && depth < stack.length) {
      // zdejmujemy ze stosu OD RAZU (React zamknie nakładkę dopiero po przerysowaniu), żeby
      // closeLayersThen i kolejne "wstecz" widziały aktualny stan stosu
      stack.pop();
      top.poppedByBack = true;
      top.close();
    }
  });
}

/** Rejestruje nakładkę, gdy `open` jest prawdą; `close` zamyka ją (ustawia open=false). */
export function useLayer(open, close) {
  useEffect(() => {
    if (!open) return undefined;
    const entry = { close, poppedByBack: false };
    stack.push(entry);
    window.history.pushState({ ...(window.history.state || {}), layer: stack.length }, "");
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      // zamknięcie niezwiązane z "wstecz": zdejmujemy dołożony wpis historii
      if (!entry.poppedByBack && i >= 0) window.history.back();
    };
    // `close` celowo poza zależnościami: nakładka żyje, dopóki trwa `open`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/**
 * Przycisk "wstecz" w Androidzie (Capacitor nie obsługuje go sam): najpierw zamyka nakładki,
 * potem wraca na Start, a na Starcie zamyka aplikację. Zwraca funkcję sprzątającą.
 */
export function initBackButton({ getPath, goHome }) {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle;
  import("@capacitor/app").then(({ App }) => {
    App.addListener("backButton", () => {
      if (closeTopLayer()) return;
      if (getPath() !== "/") {
        goHome();
        return;
      }
      App.exitApp();
    }).then((h) => {
      handle = h;
    });
  });
  return () => handle?.remove?.();
}
