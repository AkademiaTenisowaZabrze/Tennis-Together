// Dane aplikacji webowej z Firebase (Project settings, Your apps, Web app) i
// klucz Web Push (Cloud Messaging, Web Push certificates). To są wartości
// PUBLICZNE z założenia (trafiają do każdej przeglądarki), nie sekrety.
// Dopóki któreś pole jest puste, powiadomienia w przeglądarce są wyłączone,
// a reszta aplikacji działa normalnie.
export const FIREBASE_WEB = {
  apiKey: "",
  projectId: "",
  messagingSenderId: "",
  appId: "",
  vapidKey: "",
};

export const webPushConfigured = Object.values(FIREBASE_WEB).every(Boolean);
