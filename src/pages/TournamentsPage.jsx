import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTournaments, sourceLabel } from "../lib/useTournaments.js";
import { useTrips } from "../lib/useTrips.js";
import { usePlayers } from "../lib/usePlayers.js";
import { useAuth } from "../lib/AuthContext.jsx";
import ErrorBox from "../components/ErrorBox.jsx";
import { inputStyle, labelStyle } from "../components/formStyles.js";

const SOURCES = [
  { key: "all", label: "Wszystkie" },
  { key: "otk", label: "PZT" },
  { key: "tennis_europe", label: "Tennis Europe" },
  { key: "itf", label: "ITF" },
];

const dateFormatter = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" });

// Adres strony turnieju pochodzi z bazy (import z PZT/Tennis Europe), więc przed wstawieniem do linku
// przepuszczamy tylko http/https: inaczej wpis typu javascript: mógłby uruchomić kod po kliknięciu (F18).
function safeHttpUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function formatRange(startsOn, endsOn) {
  const start = dateFormatter.format(new Date(startsOn));
  if (!endsOn || endsOn === startsOn) return start;
  return `${start}–${dateFormatter.format(new Date(endsOn))}`;
}

export default function TournamentsPage() {
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [country, setCountry] = useState("all");
  const [openTournamentId, setOpenTournamentId] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const { tournaments, loading, error } = useTournaments();
  const { account } = useAuth();
  const { players, loading: playersLoading } = usePlayers(account?.id);
  const { trips, createTrip } = useTrips(account?.id);

  // Deep-link z Przejazdów/Noclegów ("najpierw zgłoś wyjazd na TEN turniej")
  // i z wyszukiwarki po zawodniku — ?turniej=<id> w URL od razu otwiera
  // formularz zgłoszenia dla właściwego turnieju, zamiast zostawiać
  // użytkownika z generycznym linkiem do przewinięcia całego kalendarza.
  // Resetujemy filtry, bo docelowy turniej mógłby akurat nie pasować do
  // aktualnie wybranego źródła/kategorii/kraju i zniknąć z listy.
  useEffect(() => {
    const targetId = searchParams.get("turniej");
    if (!targetId || !tournaments.some((t) => t.id === targetId)) return;
    setSource("all");
    setCategory("all");
    setCountry("all");
    setOpenTournamentId(targetId);
    setSearchParams({}, { replace: true });
  }, [searchParams, tournaments, setSearchParams]);

  useEffect(() => {
    if (!openTournamentId) return;
    const timer = setTimeout(() => {
      document.getElementById(`tournament-${openTournamentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    return () => clearTimeout(timer);
  }, [openTournamentId]);

  // Listy do filtrów wyliczone z tego, co faktycznie jest w kalendarzu —
  // nie na sztywno, bo OTK i Tennis Europe mają różne zestawy kategorii/krajów.
  const categories = [...new Set(tournaments.map((t) => t.category).filter(Boolean))].sort();
  const countries = [...new Set(tournaments.map((t) => t.country).filter(Boolean))].sort();

  const visible = tournaments.filter(
    (t) =>
      (source === "all" || t.source === source) &&
      (category === "all" || t.category === category) &&
      (country === "all" || t.country === country)
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h1>Turnieje</h1>

      <div className="chip-row">
        {SOURCES.map((s) => (
          <button
            key={s.key}
            className={`chip ${source === s.key ? "is-active" : ""}`}
            onClick={() => setSource(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {(categories.length > 0 || countries.length > 0) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {categories.length > 0 && (
            <select style={{ ...inputStyle, width: "auto" }} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">Wszystkie kategorie</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          {countries.length > 0 && (
            <select style={{ ...inputStyle, width: "auto" }} value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="all">Wszystkie kraje</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {error && <ErrorBox>Nie udało się wczytać turniejów: {error}</ErrorBox>}
      {loading && <p style={{ color: "var(--color-text-muted)" }}>Wczytywanie…</p>}

      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map((t) => {
            const tripsForTournament = trips.filter((tr) => tr.tournament_id === t.id);
            return (
              <div key={t.id} id={`tournament-${t.id}`} className="glass-card">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <span className="status-pill muted">{sourceLabel(t.source)}</span>
                    <p style={{ margin: "8px 0 2px", fontWeight: 700, fontSize: 16 }}>{t.name}</p>
                    <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: 13 }}>
                      {t.city ?? "Miasto nieznane"} · {t.category} · {formatRange(t.starts_on, t.ends_on)}
                    </p>
                  </div>
                  <div className="avatar-circle" title="Kategoria wiekowa">
                    {t.category}
                  </div>
                </div>

                {tripsForTournament.length > 0 && (
                  <p style={{ margin: "12px 0 0", fontSize: 13 }}>
                    <span className="badge-verified">
                      ✅ Jedziesz: {tripsForTournament.map((tr) => tr.players?.first_name).join(", ")}
                    </span>
                  </p>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button
                    className="btn-primary"
                    onClick={() => setOpenTournamentId(openTournamentId === t.id ? null : t.id)}
                  >
                    {openTournamentId === t.id ? "Anuluj" : "Jadę na ten turniej"}
                  </button>
                  {tripsForTournament.length > 0 && (
                    <Link className="btn-ghost" to="/moje-wyjazdy">
                      Zobacz w Moich wyjazdach
                    </Link>
                  )}
                  {safeHttpUrl(t.website_url) && (
                    <a className="btn-ghost" href={safeHttpUrl(t.website_url)} target="_blank" rel="noreferrer">
                      Strona turnieju
                    </a>
                  )}
                </div>

                {openTournamentId === t.id && (
                  <JoinTripForm
                    tournamentId={t.id}
                    players={players}
                    playersLoading={playersLoading}
                    createTrip={createTrip}
                    onDone={() => setOpenTournamentId(null)}
                  />
                )}
              </div>
            );
          })}
          {visible.length === 0 && (
            <p style={{ color: "var(--color-text-muted)" }}>
              {tournaments.length === 0
                ? "Kalendarz jest jeszcze pusty — import turniejów OTK dopiero czeka na uruchomienie (patrz PLAN.md)."
                : "Brak turniejów dla tego filtra."}
            </p>
          )}
        </div>
      )}

      <p style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
        Kalendarz OTK i Tennis Europe jest importowany automatycznie
        codziennie (scraper PZT + te.tournamentsoftware.com). ITF na start
        dodawane ręcznie / przez zgłoszenia (patrz PLAN.md).
      </p>
    </div>
  );
}

function JoinTripForm({ tournamentId, players, playersLoading, createTrip, onDone }) {
  const [pickedPlayerId, setPlayerId] = useState("");
  const playerId = pickedPlayerId || players[0]?.id || "";
  const [departureCity, setDepartureCity] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (playersLoading) {
    return <p style={{ marginTop: 12, color: "var(--color-text-muted)" }}>Wczytywanie zawodników…</p>;
  }

  if (players.length === 0) {
    return (
      <div className="glass-card" style={{ marginTop: 12 }}>
        <p style={{ margin: "0 0 12px", fontSize: 13 }}>
          Najpierw dodaj zawodnika, żeby zgłosić wyjazd na turniej.
        </p>
        <Link className="btn-primary" to="/profil">
          Dodaj zawodnika w Profilu
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!departureCity.trim()) {
      setError("Podaj miasto wyjazdu — to po nim aplikacja dopasowuje przejazdy i noclegi.");
      return;
    }
    setBusy(true);
    const { error } = await createTrip({
      playerId,
      tournamentId,
      departureCity: departureCity.trim(),
    });
    setBusy(false);
    if (error) {
      setError(
        error.code === "23505"
          ? "Ten zawodnik już ma zgłoszony wyjazd na ten turniej."
          : error.message || "Nie udało się zapisać wyjazdu."
      );
      return;
    }
    onDone();
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--color-card-border)" }}
    >
      {players.length > 1 && (
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Który zawodnik jedzie?</label>
          <div className="chip-row">
            {players.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip ${playerId === p.id ? "is-active" : ""}`}
                onClick={() => setPlayerId(p.id)}
              >
                {p.first_name}
              </button>
            ))}
          </div>
        </div>
      )}

      <label style={labelStyle}>Miasto wyjazdu</label>
      <input
        style={inputStyle}
        placeholder="np. Katowice"
        value={departureCity}
        onChange={(e) => setDepartureCity(e.target.value)}
        autoFocus
      />

      {error && (
        <p style={{ color: "var(--color-secondary)", fontSize: 13, margin: "8px 0 0" }}>{error}</p>
      )}

      <button className="btn-primary" type="submit" disabled={busy} style={{ marginTop: 10 }}>
        {busy ? "Zapisuję…" : "Potwierdź wyjazd"}
      </button>
    </form>
  );
}
