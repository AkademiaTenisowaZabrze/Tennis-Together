// Dane aplikacji webowej z Firebase (Project settings, Your apps, Web app) i
// klucz Web Push (Cloud Messaging, Web Push certificates). To są wartości
// PUBLICZNE z założenia (trafiają do każdej przeglądarki), nie sekrety.
// Dopóki któreś pole jest puste, powiadomienia w przeglądarce są wyłączone,
// a reszta aplikacji działa normalnie.
export const FIREBASE_WEB = {
  apiKey: "AIzaSyDF7XW5W05tpmYn41-K0tjY1ly6j1aLJwQ",
  projectId: "tennis-together-e3c9d",
  messagingSenderId: "928484232441",
  appId: "1:928484232441:web:cf4844d9dbf91a955a2628",
  vapidKey: "",
};

export const webPushConfigured = Object.values(FIREBASE_WEB).every(Boolean);
