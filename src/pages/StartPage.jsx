import { useState } from "react";
import { Icon, InlineIcon, TileIcon, renderIcon } from "../components/Icon.jsx";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/AuthContext.jsx";
import { usePlayers } from "../lib/usePlayers.js";
import { useTrips } from "../lib/useTrips.js";
import { useClubRoster } from "../lib/useClubRoster.js";
import { useDataSyncStatus } from "../lib/useDataSyncStatus.js";
import { useTripArrangements, ARRANGEMENT_LABELS } from "../lib/useTripArrangements.js";
import { useJoinRequests } from "../lib/useJoinRequests.js";
import { useRidePings } from "../lib/useRidePings.js";
import { Section, ListItem, EmptyState } from "../components/ui.jsx";

const dateFormatter = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" });

function formatRange(startsOn, endsOn) {
  const start = dateFormatter.format(new Date(startsOn));
  if (!endsOn || endsOn === startsOn) return start;
  return `${start}–${dateFormatter.format(new Date(endsOn))}`;
}

const FIRST_NAME_GREETING = (fullName) => (fullName ?? "").trim().split(/\s+/)[0] || null;

const timeFormatter = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit" });

function formatSyncTime(date) {
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday ? `dziś o ${timeFormatter.format(date)}` : `${dateFormatter.format(date)} o ${timeFormatter.format(date)}`;
}

// "Za 4 dni", "Jutro", "Dziś": ile zostało do turnieju (liczone w dniach kalendarzowych).
export function daysUntilLabel(startsOn, now = new Date()) {
  const start = new Date(startsOn);
  const days = Math.round((new Date(start.toDateString()) - new Date(now.toDateString())) / 86400000);
  if (days <= 0) return "Dziś";
  if (days === 1) return "Jutro";
  return `Za ${days} dni`;
}

// Mały podpis zamiast banera: kiedy zaktualizowano dane turniejów, z ręcznym odświeżeniem.
function SyncCaption({ onRefresh }) {
  const { lastSyncedAt, refresh: refreshStatus } = useDataSyncStatus();
  const [refreshing, setRefreshing] = useState(false);
  if (!lastSyncedAt) return null;
  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshStatus(), onRefresh()]);
    setRefreshing(false);
  };
  return (
    <p className="small-note" style={{ textAlign: "center", margin: "14px 0 0" }}>
      Dane turniejów zaktualizowano {formatSyncTime(lastSyncedAt)}.{" "}
      <button type="button" className="link-btn" onClick={handleRefresh} disabled={refreshing}>
        {refreshing ? "Odświeżam…" : "Odśwież teraz"}
      </button>
    </p>
  );
}

export default function StartPage() {
  const { account } = useAuth();
  const { players, loading: playersLoading, refresh: refreshPlayers } = usePlayers(account?.id);
  const { trips, loading: tripsLoading, refresh: refreshTrips } = useTrips(account?.id);
  const { byTrip } = useTripArrangements();
  const { players: clubPlayers, trips: clubTrips } = useClubRoster(account?.role === "coach" ? account.club_name : null);
  const rideRequests = useJoinRequests("ride", account?.id);
  const lodgingRequests = useJoinRequests("lodging", account?.id);
  const pings = useRidePings(account?.id);

  const loading = playersLoading || tripsLoading;
  const today = new Date().toISOString().slice(0, 10);
  const upcomingTrips = trips
    .filter((t) => t.tournaments && t.tournaments.starts_on >= today)
    .sort((a, b) => new Date(a.tournaments.starts_on) - new Date(b.tournaments.starts_on));
  const nextTrip = upcomingTrips[0];

  const firstName = FIRST_NAME_GREETING(account?.full_name);
  const clubUpcomingCount = clubTrips.filter((t) => t.tournaments && t.tournaments.starts_on >= today).length;

  // "Do zrobienia": cudze prośby, które czekają na Twoją odpowiedź
  const pendingRide = (rideRequests.incoming ?? []).filter((r) => r.status === "pending").length;
  const pendingLodging = (lodgingRequests.incoming ?? []).filter((r) => r.status === "pending").length;
  const pendingPings = (pings.incoming ?? []).filter((r) => r.status === "pending").length;
  const todo = [
    pendingRide > 0 && { key: "ride", to: "/wyjazdy/przejazdy", title: `Prośby o miejsce w aucie: ${pendingRide}`, sub: "Odpowiedz, żeby rodzina mogła zaplanować wyjazd" },
    pendingPings > 0 && { key: "ping", to: "/wyjazdy/moje", title: `Zapytania o podwiezienie: ${pendingPings}`, sub: "Ktoś z listy startowej pyta o wspólny przejazd" },
    pendingLodging > 0 && { key: "lodging", to: "/wyjazdy/noclegi", title: `Prośby o nocleg: ${pendingLodging}`, sub: "Czekają na Twoją odpowiedź" },
  ].filter(Boolean);

  const arrangement = nextTrip ? byTrip.get(nextTrip.id) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <h1 className="ttl">{firstName ? `Cześć, ${firstName}!` : "Cześć!"}</h1>
      <p className="sub">Twój najbliższy wyjazd i to, co wymaga uwagi.</p>

      {!loading && (
        <>
          {players.length === 0 ? (
            <Section icon="ball" title="Zacznij od dodania zawodnika">
              <p className="sec-note">
                Żeby zgłosić wyjazd na turniej i znaleźć dla niego przejazd czy nocleg, najpierw potrzebujemy profilu zawodnika.
              </p>
              <Link className="btn-primary btn-block" to="/profil">
                Dodaj zawodnika
              </Link>
            </Section>
          ) : nextTrip ? (
            <div className="hero-card">
              <span className="pill"><InlineIcon name="ball" size={16} />{daysUntilLabel(nextTrip.tournaments.starts_on)}</span>
              <p className="hero-title">{nextTrip.tournaments.name}</p>
              <p className="hero-meta">
                {nextTrip.players?.first_name} · {formatRange(nextTrip.tournaments.starts_on, nextTrip.tournaments.ends_on)}
                {nextTrip.tournaments.city ? ` · ${nextTrip.tournaments.city}` : ""} · wyjazd z {nextTrip.departure_city}
              </p>
              <div className="chips">
                {[["car", "Transport", arrangement?.ride], ["bed", "Nocleg", arrangement?.lodging]].map(([icon, label, v]) => {
                  const info = ARRANGEMENT_LABELS[v];
                  return (
                    <span key={label} className={`status-pill ${info?.cls ?? "muted"}`}>
                      <TileIcon name={icon} size={22} style={{ marginRight: 6, verticalAlign: "-6px" }} />
                      {label}: {info?.check && <InlineIcon name="check" size={14} />}{info?.text ?? "brak danych"}
                    </span>
                  );
                })}
              </div>
              <Link className="btn-primary btn-block" to="/wyjazdy/moje">
                Zobacz wyjazd
              </Link>
            </div>
          ) : (
            <Section icon="trophy" title="Nie masz jeszcze zgłoszonego wyjazdu">
              <p className="sec-note">
                Przeglądaj kalendarz turniejów i kliknij „Jadę na ten turniej”, żeby zacząć szukać przejazdu i noclegu.
              </p>
              <Link className="btn-primary btn-block" to="/turnieje">
                Znajdź turniej
              </Link>
            </Section>
          )}

          {todo.length > 0 && (
            <Section icon="bell" title="Do zrobienia">
              {todo.map((t) => (
                <Link key={t.key} to={t.to} style={{ textDecoration: "none", color: "inherit" }}>
                  <ListItem title={t.title} subtitle={t.sub}>
                    <span aria-hidden="true" style={{ padding: "0 8px", fontSize: 22, color: "var(--muted)" }}>›</span>
                  </ListItem>
                </Link>
              ))}
            </Section>
          )}

          {players.length > 0 && !nextTrip && todo.length === 0 && (
            <EmptyState icon="route">Gdy zgłosisz wyjazd, tu pojawi się jego postęp i rzeczy do załatwienia.</EmptyState>
          )}

          {account?.role === "coach" && account.club_name && (
            <Link to="/klub" style={{ textDecoration: "none", color: "inherit" }}>
              <ListItem title={`Klub: ${account.club_name}`} subtitle={`${clubPlayers.length} zawodników · ${clubUpcomingCount} zgłoszonych wyjazdów`}>
                <span aria-hidden="true" style={{ padding: "0 8px", fontSize: 22, color: "var(--muted)" }}>›</span>
              </ListItem>
            </Link>
          )}
        </>
      )}

      <SyncCaption onRefresh={() => Promise.all([refreshPlayers(), refreshTrips()])} />
    </div>
  );
}
