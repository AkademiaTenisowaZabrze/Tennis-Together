import { useEffect, useRef } from "react";

// "Nie jestem robotem" (Cloudflare Turnstile) dla logowania, rejestracji i resetu hasła.
// Chroni przed masowym zakładaniem kont przez boty, które zapychają limit maili i bazę.
//
// Działa tylko wtedy, gdy zmienna VITE_TURNSTILE_SITE_KEY jest ustawiona (klucz witryny jest
// publiczny z założenia). Bez niej komponent nic nie renderuje i od razu zgłasza "brak wymagania"
// (onToken(null)), więc aplikacja zachowuje się jak dawniej. Po stronie Supabase captchę włącza się
// osobno (Authentication, Attack Protection), dopiero gdy wszyscy mają wersję z tym komponentem.
//
// Token Turnstile jest jednorazowy: po każdej próbie (udanej lub nie) formularz zwiększa `resetKey`,
// a widżet generuje nowy.

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise = null;

function loadTurnstile() {
  if (typeof window === "undefined") return Promise.reject(new Error("brak okna"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile niedostępny")));
      s.onerror = () => {
        scriptPromise = null; // pozwól spróbować ponownie przy następnym otwarciu formularza
        reject(new Error("nie udało się załadować Turnstile"));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export const captchaEnabled = () => Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY);

export default function Captcha({ onToken, resetKey = 0 }) {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const boxRef = useRef(null);
  const widgetRef = useRef(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!siteKey) {
      onTokenRef.current(null);
      return undefined;
    }
    let cancelled = false;
    onTokenRef.current(null);
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !boxRef.current) return;
        if (widgetRef.current != null) {
          turnstile.reset(widgetRef.current);
          return;
        }
        widgetRef.current = turnstile.render(boxRef.current, {
          sitekey: siteKey,
          theme: "dark",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        // brak sieci do Cloudflare: formularz pozostaje zablokowany, bo Supabase i tak zażąda tokenu
      });
    return () => {
      cancelled = true;
    };
  }, [siteKey, resetKey]);

  useEffect(
    () => () => {
      if (widgetRef.current != null && window.turnstile) {
        try {
          window.turnstile.remove(widgetRef.current);
        } catch {
          // widżet mógł już zniknąć razem z formularzem
        }
        widgetRef.current = null;
      }
    },
    []
  );

  if (!siteKey) return null;
  return <div ref={boxRef} data-testid="captcha" style={{ minHeight: 65, display: "flex", justifyContent: "center" }} />;
}
