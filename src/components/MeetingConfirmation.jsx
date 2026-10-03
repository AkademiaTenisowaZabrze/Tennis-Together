import { useState } from "react";
import QRCode from "qrcode";
import { inputStyle } from "./formStyles.js";

// "Potwierdź spotkanie" — druga warstwa bezpieczeństwa obok weryfikacji
// PZT (patrz ProfilePage.jsx): nie sprawdza KIM jest druga osoba, tylko
// że na miejscu spotkania to naprawdę strona zaakceptowanego
// przejazdu/noclegu (0018_meeting_confirmation.sql). Współdzielony
// między RidesPage.jsx i LodgingPage.jsx — identyczna logika po obu
// stronach (przejazd/nocleg), różni się tylko tabelą pod spodem, którą
// hook `joinRequests` już abstrahuje.
export default function MeetingConfirmation({ request, joinRequests }) {
  const [mode, setMode] = useState(null); // null | "show" | "enter"
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [enteredCode, setEnteredCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (request.meeting_confirmed_at) {
    return <span className="badge-verified">🤝 Spotkanie potwierdzone</span>;
  }

  const handleShowCode = async () => {
    setBusy(true);
    setError(null);
    const { data, error } = await joinRequests.generateMeetingCode(request.id);
    setBusy(false);
    if (error || !data?.meeting_code) {
      setError("Nie udało się wygenerować kodu.");
      return;
    }
    setQrDataUrl(await QRCode.toDataURL(data.meeting_code, { width: 180, margin: 1 }));
    setMode("show");
  };

  const handleVerify = async () => {
    if (!enteredCode.trim()) return;
    setBusy(true);
    setError(null);
    const { error, failure, attemptsLeft } = await joinRequests.verifyMeetingCode(request.id, enteredCode);
    setBusy(false);
    if (failure === "mismatch") {
      setError(`Kod się nie zgadza. Sprawdź i spróbuj ponownie (pozostało prób: ${attemptsLeft ?? 0}).`);
      return;
    }
    if (failure === "locked") {
      setError("Zbyt wiele błędnych prób. Niech druga osoba wygeneruje nowy kod.");
      return;
    }
    if (failure === "own_code") {
      setError("To Twój własny kod. Wpisać go musi druga osoba.");
      return;
    }
    if (failure === "no_code") {
      setError("Druga osoba nie wygenerowała jeszcze kodu.");
      return;
    }
    if (failure || error) setError("Nie udało się potwierdzić.");
  };

  if (!mode) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn-ghost" onClick={handleShowCode} disabled={busy}>
            📱 Pokaż mój kod
          </button>
          <button type="button" className="btn-ghost" onClick={() => setMode("enter")} disabled={busy}>
            🔢 Wpisz kod drugiej osoby
          </button>
        </div>
        {/* Błąd generowania kodu musi być widoczny także przed wejściem w tryb "show" */}
        {error && <p style={{ margin: 0, fontSize: 13, color: "var(--color-secondary)" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {mode === "show" && qrDataUrl && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
          <img src={qrDataUrl} alt="Kod QR do potwierdzenia spotkania" width={160} height={160} style={{ borderRadius: 12 }} />
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>
            Niech druga osoba zeskanuje ten kod aparatem telefonu (albo wpisze ręcznie):{" "}
            <strong style={{ color: "var(--color-text)", letterSpacing: 1 }}>{request.meeting_code}</strong>
          </p>
        </div>
      )}
      {mode === "enter" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            style={{ ...inputStyle, width: 140 }}
            placeholder="np. 4F7K2A"
            value={enteredCode}
            onChange={(e) => setEnteredCode(e.target.value.toUpperCase())}
          />
          <button type="button" className="btn-primary" onClick={handleVerify} disabled={busy}>
            {busy ? "Sprawdzam…" : "Potwierdź"}
          </button>
        </div>
      )}
      {error && <p style={{ margin: 0, fontSize: 13, color: "var(--color-secondary)" }}>{error}</p>}
      <button type="button" className="btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setMode(null)}>
        Anuluj
      </button>
    </div>
  );
}
