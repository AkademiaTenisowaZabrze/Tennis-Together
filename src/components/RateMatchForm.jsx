import { useEffect, useState } from "react";
import { Icon, InlineIcon, TileIcon, renderIcon } from "./Icon.jsx";
import { hasRated, submitRating } from "../lib/useRatings.js";
import { inputStyle } from "./formStyles.js";

// Ocena po potwierdzonym spotkaniu (0022_ratings.sql) — jedyny etap
// zaufania "po fakcie": PZT, zdjęcie i kod/QR działają przed/w trakcie
// spotkania, to domyka pętlę tym, jak poszło. Widoczne tylko gdy
// spotkanie faktycznie potwierdzono kodem (meeting_confirmed_at) — patrz
// warunek renderowania w miejscu użycia tego komponentu.
export default function RateMatchForm({ joinRequestId, kind, raterAccountId, ratedAccountId }) {
  const [checking, setChecking] = useState(true);
  const [alreadyRated, setAlreadyRated] = useState(false);
  const [stars, setStars] = useState(0);
  const [hoverStars, setHoverStars] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hasRated(joinRequestId, kind).then((yes) => {
      if (!cancelled) {
        setAlreadyRated(yes);
        setChecking(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [joinRequestId, kind]);

  if (checking) return null;
  if (alreadyRated || done) {
    return <span className="badge-verified"><InlineIcon name="star" />Oceniono</span>;
  }

  const handleSubmit = async () => {
    if (stars === 0) {
      setError("Wybierz liczbę gwiazdek.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await submitRating({ joinRequestId, kind, raterAccountId, ratedAccountId, stars, comment });
    setBusy(false);
    if (error) {
      setError("Nie udało się zapisać oceny. Spróbuj ponownie.");
      return;
    }
    setDone(true);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600 }}>Jak poszło?</p>
        <div style={{ display: "flex", gap: 4 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setStars(n)}
              onMouseEnter={() => setHoverStars(n)}
              onMouseLeave={() => setHoverStars(0)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 24,
                padding: 0,
                lineHeight: 1,
                opacity: n <= (hoverStars || stars) ? 1 : 0.3,
              }}
              aria-label={`${n} gwiazdek`}
            >
              <Icon name="star" size={28} style={{ color: "var(--warn)" }} />
            </button>
          ))}
        </div>
      </div>
      <textarea
        style={{ ...inputStyle, minHeight: 60 }}
        placeholder="Komentarz (opcjonalnie)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {error && <p style={{ margin: 0, fontSize: 13, color: "var(--color-secondary)" }}>{error}</p>}
      <button className="btn-primary" type="button" onClick={handleSubmit} disabled={busy} style={{ alignSelf: "flex-start" }}>
        {busy ? "Zapisuję…" : "Wyślij ocenę"}
      </button>
    </div>
  );
}
