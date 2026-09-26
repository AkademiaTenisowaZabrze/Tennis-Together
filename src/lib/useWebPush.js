import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "./supabase.js";
import { FIREBASE_WEB, webPushConfigured } from "./firebaseWebConfig.js";

export const webPushSupported =
  typeof window !== "undefined" &&
  !Capacitor.isNativePlatform() &&
  "Notification" in window &&
  "serviceWorker" in navigator &&
  "PushManager" in window;

function waitForActive(reg) {
  if (reg.active) return Promise.resolve();
  const worker = reg.installing || reg.waiting;
  return new Promise((resolve) => {
    if (!worker) return resolve();
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") resolve();
    });
  });
}

async function registerToken(accountId) {
  const { initializeApp, getApps } = await import("firebase/app");
  const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
  if (!(await isSupported())) throw new Error("Ta przeglądarka nie obsługuje powiadomień push.");

  const { vapidKey, ...config } = FIREBASE_WEB;
  const app = getApps()[0] ?? initializeApp(config);
  const base = import.meta.env.BASE_URL;
  const reg = await navigator.serviceWorker.register(`${base}push-sw.js`, { scope: `${base}push/` });
  await waitForActive(reg);

  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: reg });
  if (!token) throw new Error("Nie udało się uzyskać tokenu powiadomień.");

  const { error } = await supabase
    .from("device_tokens")
    .upsert({ account_id: accountId, token, platform: "web" }, { onConflict: "account_id,token" });
  if (error) throw error;
  try {
    localStorage.setItem("tennis-together-push-token", token);
  } catch {
    // localStorage może być niedostępny (tryb prywatny)
  }
}

// Powiadomienia push w przeglądarce. Prośbę o zgodę pokazujemy dopiero po
// kliknięciu przycisku (enable), a jeśli zgoda już jest, po cichu odświeżamy
// token przy starcie, żeby nie wygasł.
export function useWebPush(accountId) {
  const [permission, setPermission] = useState(() =>
    webPushSupported ? Notification.permission : "unsupported"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!accountId || !webPushSupported || !webPushConfigured) return;
    if (Notification.permission !== "granted") return;
    registerToken(accountId).catch((e) => console.error("[web-push]", e));
  }, [accountId]);

  const enable = useCallback(async () => {
    if (!accountId || !webPushSupported || !webPushConfigured) return;
    setError(null);
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === "granted") await registerToken(accountId);
    } catch (e) {
      setError(e.message || "Nie udało się włączyć powiadomień.");
    } finally {
      setBusy(false);
    }
  }, [accountId]);

  return { permission, busy, error, enable, available: webPushSupported && webPushConfigured };
}
