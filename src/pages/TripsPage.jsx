import { useState } from "react";
import { useAuth } from "../lib/AuthContext.jsx";
import { useTrips } from "../lib/useTrips.js";
import { useTournamentMatches } from "../lib/useTournamentMatches.js";
import { useRidePings } from "../lib/useRidePings.js";
import ErrorBox from "../components/ErrorBox.jsx";

const FILTERS = [
  { key: "upcoming", label: "Nadchodzące" },
  { key: "organizing", label: "W trakcie organizacji" },
  { key: "completed", label: "Zakończone" },
];

const dateFormatter = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" });

function formatRange(startsOn, endsOn) {
  if (!startsOn) return "termin nieznany";
  const start = dateFormatter.format(new Date(startsOn));
  if (!endsOn || endsOn === startsOn) return start;
  return `${start}–${dateFormatter.format(new Date(endsOn))}`;
}

// Klasyfikacja karty do zakładki: "zakończone" po dacie turnieju albo po
// jawnym statusie; reszta dzieli się na "nadchodzące" (status=confirmed) i
// "w trakcie organizacji" (status=planning — domyślny dla każdego nowego
// "Jadę na ten turniej", dopóki nikt niczego nie potwierdzi).
function classify(trip) {
  const startsOn = trip.tournaments?.starts_on;
  const isPast = startsOn ? new Date(startsOn) < new Date(new Date().toDateString()) : false;
  if (trip.status === "completed" || isPast) return "completed";
  if (trip.status === "confirmed") return "upcoming";
  return "organizing";
}

export default function TripsPage() {
  const [filter, setFilter] = useState("upcoming");
  const { account } = useAuth();
  const { trips, loading, error } = useTrips(account?.id);

  const visible = trips.filter((t) => classify(t) === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h1>Moje wyjazdy</h1>

      <div className="chip-row">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`chip ${filter === f.key ? "is-active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <ErrorBox>Nie udało się wczytać wyjazdów: {error}</ErrorBox>}
      {loading && <p style={{ color: "var(--color-text-muted)" }}>Wczytywanie…</p>}

      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map((t) => (
            <div key={t.id} className="glass-card">
              <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 16 }}>
                {t.tournaments?.name ?? "Turniej"}
              </p>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-muted)" }}>
                {formatRange(t.tournaments?.starts_on, t.tournaments?.ends_on)} ·{" "}
                {t.players?.first_name} {t.players?.last_name} · wyjazd z {t.departure_city}
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                <Row label="🚗 Transport" text="Jeszcze nikt się nie zgłosił" state="muted" />
                <Row label="🏨 Nocleg" text="Jeszcze nikt się nie zgłosił" state="muted" />
              </div>

              <MatchedEntrants trip={t} />

              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost">💬 Czat grupy (wkrótce)</button>
              </div>
            </div>
          ))}
          {visible.length === 0 && (
            <p style={{ color: "var(--color-text-muted)" }}>
              {trips.length === 0
                ? 'Nie masz jeszcze żadnego wyjazdu — zacznij od zakładki "Turnieje" i przycisku "Jadę na ten turniej".'
                : "Brak wyjazdów w tej kategorii."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Zawodnicy z oficjalnej listy startowej PZT (po selekcji), którzy są już
// w Tennis Together i sami też jadą na ten turniej — patrz
// useTournamentMatches.js. Pojawia się dopiero, gdy PZT opublikuje selekcję
// (patrz scripts/import_tournament_entries.py), więc dla większości
// wyjazdów ta sekcja po prostu jeszcze nic nie pokaże.
function MatchedEntrants({ trip }) {
  const { matches, loading } = useTournamentMatches(trip.tournament_id);
  const { outgoing, sendPing } = useRidePings(trip.created_by_account_id);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);

  if (loading || matches.length === 0) return null;

  const pingFor = (accountId) => outgoing.find((p) => p.target_trip?.created_by_account_id === accountId);

  const handleAsk = async (match) => {
    setBusyId(match.account_id);
    setNotice(null);
    const { error } = await sendPing({
      tournamentId: trip.tournament_id,
      requesterTripId: trip.id,
      targetTripId: match.trip_id,
    });
    setBusyId(null);
    if (error) setNotice(error.message || "Nie udało się wysłać zapytania.");
  };

  return (
    <div style={{ marginBottom: 12, padding: 12, borderRadius: 12, background: "var(--color-bg-elevated)" }}>
      <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700 }}>
        🎾 Zgłoszeni na ten turniej (lista PZT), już w Tennis Together
      </p>
      {notice && <ErrorBox>{notice}</ErrorBox>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {matches.map((m) => {
          const ping = pingFor(m.account_id);
          return (
            <div key={m.account_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13 }}>
                {m.full_name}
                {m.club && <span style={{ color: "var(--color-text-muted)" }}> · {m.club}</span>}
              </span>
              {!ping ? (
                <button className="btn-ghost" disabled={busyId === m.account_id} onClick={() => handleAsk(m)}>
                  {busyId === m.account_id ? "Wysyłam…" : "Poproś o podwiezienie"}
                </button>
              ) : ping.status === "pending" ? (
                <span className="status-pill muted">Wysłano, czekam na odpowiedź</span>
              ) : ping.status === "accepted" ? (
                <span className="status-pill ok">Zaakceptowano — sprawdź Wiadomości</span>
              ) : ping.status === "declined" ? (
                <span className="status-pill muted">Odrzucono</span>
              ) : (
                <span className="status-pill muted">Anulowano</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, text, state }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{label}</span>
      <span className={`status-pill ${state}`}>{text}</span>
    </div>
  );
}
