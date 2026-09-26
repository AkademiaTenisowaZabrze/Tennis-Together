import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/AuthContext.jsx";
import { useTrips } from "../lib/useTrips.js";
import { useRideOffers, useRideRequests } from "../lib/useRides.js";
import { useJoinRequests } from "../lib/useJoinRequests.js";
import { useCityCoordinates, findCityCoords, haversineKm } from "../lib/useCityCoordinates.js";
import ErrorBox from "../components/ErrorBox.jsx";
import MeetingConfirmation from "../components/MeetingConfirmation.jsx";
import CounterpartCard from "../components/CounterpartCard.jsx";
import RateMatchForm from "../components/RateMatchForm.jsx";
import StarRating from "../components/StarRating.jsx";
import { inputStyle, labelStyle } from "../components/formStyles.js";

const dateFormatter = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" });

const STATUS_LABELS = {
  pending: { text: "Prośba wysłana — czeka na odpowiedź", cls: "pending" },
  accepted: { text: "Zaakceptowano ✅", cls: "ok" },
  declined: { text: "Odrzucono", cls: "muted" },
  cancelled: { text: "Anulowano", cls: "muted" },
};

function tripLabel(trip) {
  const t = trip?.tournaments;
  if (!t) return "Turniej";
  const date = t.starts_on ? dateFormatter.format(new Date(t.starts_on)) : "termin nieznany";
  return `${t.name} (${date})`;
}

export default function RidesPage() {
  const [tab, setTab] = useState("offers"); // "offers" | "requests"
  const [showForm, setShowForm] = useState(false);
  const { account } = useAuth();
  const { trips } = useTrips(account?.id);
  const { offers, loading: offersLoading, error: offersError, createOffer } = useRideOffers();
  const { requests, loading: requestsLoading, error: requestsError, createRequest } = useRideRequests();
  const joinRequests = useJoinRequests("ride", account?.id);
  const { cities } = useCityCoordinates();

  // "Z mojej okolicy" — sortuje oferty po odległości od miasta z profilu
  // (account.city), nie po turnieju/dacie. Bez tego rodzic z Zabrza musi
  // ręcznie przeglądać całą listę, żeby zauważyć, że najbliższy wolny fotel
  // jest akurat z Pszczyny, a nie z drugiego końca Polski.
  const myCoords = useMemo(() => findCityCoords(cities, account?.city), [cities, account?.city]);
  const sortedOffers = useMemo(() => {
    if (!myCoords) return offers;
    const withDistance = offers.map((o) => {
      const coords = findCityCoords(cities, o.trips?.departure_city);
      return { ...o, _distanceKm: coords ? haversineKm(myCoords.lat, myCoords.lng, coords.lat, coords.lng) : null };
    });
    return withDistance.sort((a, b) => {
      if (a._distanceKm == null && b._distanceKm == null) return 0;
      if (a._distanceKm == null) return 1;
      if (b._distanceKm == null) return -1;
      return a._distanceKm - b._distanceKm;
    });
  }, [offers, cities, myCoords]);

  const switchTab = (t) => {
    setTab(t);
    setShowForm(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h1>Przejazdy</h1>

      <IncomingRequests joinRequests={joinRequests} account={account} />

      <div className="segmented">
        <button className={tab === "offers" ? "is-active" : ""} onClick={() => switchTab("offers")}>
          Mam wolne miejsce
        </button>
        <button className={tab === "requests" ? "is-active" : ""} onClick={() => switchTab("requests")}>
          Szukam przejazdu
        </button>
      </div>

      <button className="btn-primary" style={{ alignSelf: "flex-start" }} onClick={() => setShowForm((v) => !v)}>
        {showForm ? "Anuluj" : tab === "offers" ? "+ Mam wolne miejsce" : "+ Szukam przejazdu"}
      </button>

      {showForm &&
        (tab === "offers" ? (
          <AddOfferForm trips={trips} createOffer={createOffer} onDone={() => setShowForm(false)} />
        ) : (
          <AddRequestForm trips={trips} createRequest={createRequest} onDone={() => setShowForm(false)} />
        ))}

      {tab === "offers" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {offersError && <ErrorBox>Nie udało się wczytać ofert: {offersError}</ErrorBox>}
          {offersLoading && <p style={{ color: "var(--color-text-muted)" }}>Wczytywanie…</p>}
          {!offersLoading && !myCoords && offers.length > 0 && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-muted)" }}>
              Ustaw swoje miasto w <Link to="/profil">Profilu</Link> (miasto musi być z listy polskich miast), żeby zobaczyć oferty najbliższe Tobie.
            </p>
          )}
          {!offersLoading &&
            sortedOffers.map((r) => (
              <OfferCard key={r.id} offer={r} account={account} trips={trips} joinRequests={joinRequests} />
            ))}
          {!offersLoading && offers.length === 0 && (
            <p style={{ color: "var(--color-text-muted)" }}>Nikt jeszcze nie zgłosił wolnego miejsca.</p>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {requestsError && <ErrorBox>Nie udało się wczytać próśb: {requestsError}</ErrorBox>}
          {requestsLoading && <p style={{ color: "var(--color-text-muted)" }}>Wczytywanie…</p>}
          {!requestsLoading &&
            requests.map((r) => (
              <div key={r.id} className="glass-card">
                <p style={{ margin: "0 0 4px", fontWeight: 700 }}>{r.trips?.tournaments?.name ?? "Turniej"}</p>
                <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-muted)" }}>
                  Wyjazd z: {r.trips?.departure_city ?? "?"} · {r.trips?.players?.first_name ?? "Zawodnik"} · potrzebne
                  miejsca: {r.seats_needed}
                </p>
                {r.notes && (
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-muted)" }}>{r.notes}</p>
                )}
                <button className="btn-secondary">Zaproponuj przejazd (wkrótce)</button>
              </div>
            ))}
          {!requestsLoading && requests.length === 0 && (
            <p style={{ color: "var(--color-text-muted)" }}>Nikt jeszcze nie szuka przejazdu.</p>
          )}
        </div>
      )}

      <p style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
        Aplikacja docelowo dopasowuje ogłoszenia automatycznie po turnieju,
        terminie i trasie. „Zaproponuj przejazd" dla „Szukam przejazdu" — następny krok.
      </p>
    </div>
  );
}

function IncomingRequests({ joinRequests, account }) {
  const { incoming, respond } = joinRequests;
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);

  if (incoming.length === 0) return null;

  const handle = async (id, status) => {
    setBusyId(id);
    setNotice(null);
    const { error, warning } = await respond(id, status);
    setBusyId(null);
    if (error) setNotice(error.message || "Nie udało się zapisać odpowiedzi. Spróbuj ponownie.");
    else if (warning) setNotice(warning);
  };

  return (
    <div className="glass-card" style={{ borderColor: "var(--color-primary)" }}>
      <p style={{ margin: "0 0 10px", fontWeight: 700 }}>
        Prośby o dołączenie do Twoich przejazdów ({incoming.length})
      </p>
      {notice && <ErrorBox>{notice}</ErrorBox>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {incoming.map((r) => (
          <div key={r.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <strong style={{ fontSize: 14 }}>{r.requester_trip?.players?.first_name ?? "Zawodnik"}</strong>
                <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                  {" "}
                  · {r.requester_trip?.departure_city ?? "?"}
                </span>
              </div>
              {r.status === "pending" ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn-primary" disabled={busyId === r.id} onClick={() => handle(r.id, "accepted")}>
                    Akceptuj
                  </button>
                  <button className="btn-ghost" disabled={busyId === r.id} onClick={() => handle(r.id, "declined")}>
                    Odrzuć
                  </button>
                </div>
              ) : r.status === "accepted" ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="status-pill ok">Zaakceptowano ✅</span>
                  <button className="btn-ghost" disabled={busyId === r.id} onClick={() => handle(r.id, "cancelled")}>
                    Zrezygnuj
                  </button>
                </div>
              ) : (
                <span className={`status-pill ${STATUS_LABELS[r.status]?.cls ?? "muted"}`}>
                  {STATUS_LABELS[r.status]?.text ?? r.status}
                </span>
              )}
            </div>
            {r.status === "accepted" && (
              <>
                <CounterpartCard accountId={r.requester_trip?.created_by_account_id} />
                <MeetingConfirmation request={r} joinRequests={joinRequests} />
                {r.meeting_confirmed_at && (
                  <RateMatchForm
                    joinRequestId={r.id}
                    kind="ride"
                    raterAccountId={account.id}
                    ratedAccountId={r.requester_trip?.created_by_account_id}
                  />
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function OfferCard({ offer: r, account, trips, joinRequests }) {
  // Tylko wyjazdy NA TEN SAM turniej co oferta — bez tego dało się wysłać
  // prośbę o dołączenie do przejazdu na turniej X, wybierając przez
  // pomyłkę (albo brak innej opcji) swój wyjazd na turniej Y.
  const matchingTrips = trips.filter((t) => t.tournament_id === r.trips?.tournament_id);
  const [showPicker, setShowPicker] = useState(false);
  const [tripId, setTripId] = useState(matchingTrips[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isMine = r.trips?.created_by_account_id === account?.id;
  const myOutgoing = joinRequests.outgoing.find((jr) => jr.ride_offers?.id === r.id);

  const handleRequest = async () => {
    setBusy(true);
    setError(null);
    const { error } = await joinRequests.requestToJoin({ offerId: r.id, requesterTripId: tripId });
    setBusy(false);
    if (error) setError(error.message || "Nie udało się wysłać prośby.");
    else setShowPicker(false);
  };

  const handleWithdraw = async () => {
    setBusy(true);
    setError(null);
    const { error } = await joinRequests.withdraw(myOutgoing.id);
    setBusy(false);
    if (error) setError(error.message || "Nie udało się cofnąć prośby.");
  };

  const handleCancelAccepted = async () => {
    setBusy(true);
    setError(null);
    const { error } = await joinRequests.respond(myOutgoing.id, "cancelled");
    setBusy(false);
    if (error) setError(error.message || "Nie udało się zrezygnować z przejazdu.");
  };

  return (
    <div className="glass-card">
      <p style={{ margin: "0 0 4px", fontWeight: 700 }}>{r.trips?.tournaments?.name ?? "Turniej"}</p>
      <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-muted)" }}>
        🚗 {r.trips?.departure_city ?? "?"} · {r.trips?.players?.first_name ?? "Zawodnik"}
        {r.trips?.departure_date ? ` · wyjazd ${dateFormatter.format(new Date(r.trips.departure_date))}` : ""}
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <span className="status-pill ok">{r.free_seats} wolne miejsca</span>
        <StarRating accountId={r.trips?.created_by_account_id} />
        {r._distanceKm != null && (
          <span className="status-pill muted">📍 ~{Math.round(r._distanceKm)} km od Ciebie</span>
        )}
        {r.luggage_space && <span className="status-pill muted">🧳 {r.luggage_space}</span>}
        {r.cost_split_suggestion && <span className="status-pill muted">{r.cost_split_suggestion}</span>}
      </div>

      {isMine ? (
        <span className="status-pill muted">To Twoja oferta</span>
      ) : myOutgoing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
          <span className={`status-pill ${STATUS_LABELS[myOutgoing.status]?.cls ?? "muted"}`}>
            {STATUS_LABELS[myOutgoing.status]?.text ?? myOutgoing.status}
          </span>
          {error && <ErrorBox>{error}</ErrorBox>}
          {myOutgoing.status === "pending" && (
            <button className="btn-ghost" onClick={handleWithdraw} disabled={busy}>
              {busy ? "Cofam…" : "Cofnij prośbę"}
            </button>
          )}
          {myOutgoing.status === "accepted" && (
            <>
              <CounterpartCard accountId={myOutgoing.ride_offers?.trips?.created_by_account_id} />
              <button className="btn-ghost" onClick={handleCancelAccepted} disabled={busy}>
                {busy ? "Rezygnuję…" : "Zrezygnuj z przejazdu"}
              </button>
              <MeetingConfirmation request={myOutgoing} joinRequests={joinRequests} />
              {myOutgoing.meeting_confirmed_at && (
                <RateMatchForm
                  joinRequestId={myOutgoing.id}
                  kind="ride"
                  raterAccountId={account.id}
                  ratedAccountId={myOutgoing.ride_offers?.trips?.created_by_account_id}
                />
              )}
            </>
          )}
        </div>
      ) : showPicker ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {matchingTrips.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              Najpierw zgłoś wyjazd na {r.trips?.tournaments?.name ?? "ten turniej"} w{" "}
              <Link to={`/turnieje?turniej=${r.trips?.tournament_id ?? ""}`}>Turniejach</Link>.
            </p>
          ) : (
            <>
              <div className="chip-row">
                {matchingTrips.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`chip ${tripId === t.id ? "is-active" : ""}`}
                    onClick={() => setTripId(t.id)}
                  >
                    {tripLabel(t)}
                  </button>
                ))}
              </div>
              {error && <ErrorBox>{error}</ErrorBox>}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-primary" onClick={handleRequest} disabled={busy}>
                  {busy ? "Wysyłam…" : "Potwierdź prośbę"}
                </button>
                <button className="btn-ghost" onClick={() => setShowPicker(false)}>
                  Anuluj
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button className="btn-primary" onClick={() => setShowPicker(true)}>
          Poproś o miejsce
        </button>
      )}
    </div>
  );
}

function NoTripsNotice() {
  return (
    <div className="glass-card">
      <p style={{ margin: "0 0 12px", fontSize: 13 }}>
        Najpierw zgłoś wyjazd na turniej — dopiero wtedy możesz dodać do niego przejazd.
      </p>
      <Link className="btn-primary" to="/turnieje">
        Wybierz turniej
      </Link>
    </div>
  );
}

function AddOfferForm({ trips, createOffer, onDone }) {
  const [tripId, setTripId] = useState(trips[0]?.id ?? "");
  const [freeSeats, setFreeSeats] = useState(1);
  const [luggageSpace, setLuggageSpace] = useState("");
  const [costSplitSuggestion, setCostSplitSuggestion] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (trips.length === 0) return <NoTripsNotice />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await createOffer({
      tripId,
      freeSeats: Number(freeSeats) || 1,
      luggageSpace,
      costSplitSuggestion,
    });
    setBusy(false);
    if (error) {
      setError(error.message || "Nie udało się dodać oferty.");
      return;
    }
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="glass-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <TripPicker trips={trips} value={tripId} onChange={setTripId} />
      <div>
        <label style={labelStyle}>Liczba wolnych miejsc</label>
        <input
          style={inputStyle}
          type="number"
          min="1"
          value={freeSeats}
          onChange={(e) => setFreeSeats(e.target.value)}
        />
      </div>
      <div>
        <label style={labelStyle}>Miejsce na bagaż (opcjonalnie)</label>
        <input style={inputStyle} value={luggageSpace} onChange={(e) => setLuggageSpace(e.target.value)} placeholder="np. 2 torby + rakiety" />
      </div>
      <div>
        <label style={labelStyle}>Proponowany podział kosztów (opcjonalnie)</label>
        <input
          style={inputStyle}
          value={costSplitSuggestion}
          onChange={(e) => setCostSplitSuggestion(e.target.value)}
          placeholder="np. 40 zł/os. za paliwo"
        />
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button className="btn-primary" type="submit" disabled={busy}>
        {busy ? "Zapisuję…" : "Dodaj ofertę"}
      </button>
    </form>
  );
}

function AddRequestForm({ trips, createRequest, onDone }) {
  const [tripId, setTripId] = useState(trips[0]?.id ?? "");
  const [seatsNeeded, setSeatsNeeded] = useState(1);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (trips.length === 0) return <NoTripsNotice />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await createRequest({ tripId, seatsNeeded: Number(seatsNeeded) || 1, notes });
    setBusy(false);
    if (error) {
      setError(error.message || "Nie udało się dodać prośby.");
      return;
    }
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="glass-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <TripPicker trips={trips} value={tripId} onChange={setTripId} />
      <div>
        <label style={labelStyle}>Potrzebne miejsca</label>
        <input
          style={inputStyle}
          type="number"
          min="1"
          value={seatsNeeded}
          onChange={(e) => setSeatsNeeded(e.target.value)}
        />
      </div>
      <div>
        <label style={labelStyle}>Uwagi (opcjonalnie)</label>
        <input style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="np. elastyczne godziny wyjazdu" />
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button className="btn-primary" type="submit" disabled={busy}>
        {busy ? "Zapisuję…" : "Dodaj prośbę"}
      </button>
    </form>
  );
}

function TripPicker({ trips, value, onChange }) {
  return (
    <div>
      <label style={labelStyle}>Który wyjazd?</label>
      <div className="chip-row">
        {trips.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`chip ${value === t.id ? "is-active" : ""}`}
            onClick={() => onChange(t.id)}
          >
            {tripLabel(t)}
          </button>
        ))}
      </div>
    </div>
  );
}
