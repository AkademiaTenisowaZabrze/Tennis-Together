import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "./supabase.js";

// Rejestracja urządzenia do powiadomień push (Firebase Cloud Messaging,
// patrz supabase/functions/notify-tournament/) — tylko na natywnym
// Androidzie/iOS, nie w przeglądarce (PWA push to osobny mechanizm,
// niepodłączony na razie). Bez skonfigurowanego Firebase po stronie
// natywnej (google-services.json) `register()` po cichu się nie
// powiedzie — apka działa dalej normalnie, po prostu bez push.
export function usePushNotifications(accountId) {
  useEffect(() => {
    if (!accountId || !Capacitor.isNativePlatform()) return;

    let registrationListener;
    let errorListener;
    let cancelled = false;

    (async () => {
      const current = await PushNotifications.checkPermissions();
      let granted = current.receive === "granted";
      if (!granted) {
        const requested = await PushNotifications.requestPermissions();
        granted = requested.receive === "granted";
      }
      if (!granted || cancelled) return;

      registrationListener = await PushNotifications.addListener("registration", async (token) => {
        const { error } = await supabase
          .from("device_tokens")
          .upsert(
            { account_id: accountId, token: token.value, platform: Capacitor.getPlatform() },
            { onConflict: "account_id,token" }
          );
        if (error) console.error("[push] Nie udało się zapisać tokenu urządzenia:", error.message);
        else {
          try {
            localStorage.setItem("tennis-together-push-token", token.value);
          } catch {
            // brak localStorage nie może psuć rejestracji push
          }
        }
      });

      errorListener = await PushNotifications.addListener("registrationError", (err) => {
        console.error("[push] Błąd rejestracji do powiadomień:", err);
      });

      await PushNotifications.register();
    })();

    return () => {
      cancelled = true;
      registrationListener?.remove();
      errorListener?.remove();
    };
  }, [accountId]);
}
