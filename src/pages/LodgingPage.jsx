import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/AuthContext.jsx";
import { useTrips } from "../lib/useTrips.js";
import { useLodgingOffers } from "../lib/useLodging.js";
import { useJoinRequests } from "../lib/useJoinRequests.js";
import ErrorBox from "../components/ErrorBox.jsx";
import MeetingConfirmation from "../components/MeetingConfirmation.jsx";
import CounterpartCard from "../components/CounterpartCard.jsx";
import RateMatchForm from "../components/RateMatchForm.jsx";
import StarRating from "../components/StarRating.jsx";
import { inputStyle, labelStyle } from "../components/formStyles.js";

const KIND_LABELS = {
  shared_booking: "Wspólny hotel/apartament",
  roommate_wanted: "Szukam współlokatora",
};

const STATUS_LABELS = {
  pending: { text: "Prośba wysłana — czeka na odpowiedź", cls: "pending" },
  accepted: { text: "Zaakceptowano ✅", cls: "ok" },
  declined: { text: "Odrzucono", cls: "muted" },
  cancelled: { text: "Anulowano", cls: "muted" },
};

export default function LodgingPage() {
  const [showForm, setShowForm] = useState(false);
  const { account } = useAuth();
  const { trips } = useTrips(account?.id);
  const { offers, loading, error, createOffer } = useLodgingOffers();
  const joinRequests = useJoinRequests("lodging", account?.id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h1>Noclegi</h1>

      <IncomingRequests joinRequests={joinRequests} account={account} />

      {error && <ErrorBox>Nie udało się wczytać ofert noclegowych: {error}</ErrorBox>}
      {loading && <p style={{ color: "var(--color-text-muted)" }}>Wczytywanie…</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {!loading &&
          offers.map((l) => (
            <OfferCard key={l.id} offer={l} account={account} trips={trips} joinRequests={joinRequests} />
          ))}
        {!loading && offers.length === 0 && (
          <p style={{ color: "var(--color-text-muted)" }}>Nikt jeszcze nie dodał ogłoszenia noclegowego.</p>
        )}

        {/* Nocleg u rodziny — odłożony na etap 2 (patrz PLAN.md: wymaga
            weryfikacji tożsamości i konsultacji prawnej). Zostaje widoczny
            na liście, żeby użytkownicy wiedzieli, że funkcja jest planowana,
            ale wyszarzony i bez akcji. Nie ma odpowiednika w schemacie bazy
            (kind dopuszcza tylko shared_booking/roommate_wanted). */}
        <div className="glass-card card-disabled">
          <span className="status-pill muted">Nocleg u zawodnika</span>
          <p style={{ margin: "8px 0 4px", fontWeight: 700 }}>
            Rodzina przyjmuje zawodnika na czas turnieju
          </p>
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>
            Ta funkcja wymaga dodatkowej weryfikacji i zgody rodzica dla
            osoby niepełnoletniej — pracujemy nad bezpiecznymi zasadami.
          </p>
        </div>
      </div>

      <button className="btn-primary" style={{ alignSelf: "flex-start" }} onClick={() => setShowForm((v) => !v)}>
        {showForm ? "Anuluj" : "+ Dodaj ogłoszenie noclegowe"}
      </button>

      {showForm && <AddLodgingForm trips={trips} createOffer={createOffer} onDone={() => setShowForm(false)} />}
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
        Prośby o dołączenie do Twoich noclegów ({incoming.length})
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
                    kind="lodging"
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

function OfferCard({ offer: l, account, trips, joinRequests }) {
  // Tylko wyjazdy NA TEN SAM turniej co ogłoszenie — patrz komentarz przy
  // analogicznym miejscu w RidesPage.jsx.
  const matchingTrips = trips.filter((t) => t.tournament_id === l.trips?.tournament_id);
  const [showPicker, setShowPicker] = useState(false);
  const [tripId, setTripId] = useState(matchingTrips[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isMine = l.trips?.created_by_account_id === account?.id;
  const myOutgoing = joinRequests.outgoing.find((jr) => jr.lodging_offers?.id === l.id);

  const handleRequest = async () => {
    setBusy(true);
    setError(null);
    const { error } = await joinRequests.requestToJoin({ offerId: l.id, requesterTripId: tripId });
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
    if (error) setError(error.message || "Nie udało się zrezygnować z noclegu.");
  };

  return (
    <div className="glass-card">
      <span className="status-pill muted">{KIND_LABELS[l.kind] ?? l.kind}</span>
      <p style={{ margin: "8px 0 4px", fontWeight: 700 }}>{l.trips?.tournaments?.name ?? "Turniej"}</p>
      <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-muted)" }}>
        {l.place_name || `${l.trips?.departure_city ?? "?"} · ${l.trips?.players?.first_name ?? "Zawodnik"}`}
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <StarRating accountId={l.trips?.created_by_account_id} />
        {l.free_spots != null && <span className="status-pill ok">{l.free_spots} wolne miejsce</span>}
        {l.budget_per_night != null && <span className="status-pill muted">{l.budget_per_night} zł/os./noc</span>}
      </div>
      {l.notes && <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-muted)" }}>{l.notes}</p>}

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
              <CounterpartCard accountId={myOutgoing.lodging_offers?.trips?.created_by_account_id} />
              <button className="btn-ghost" onClick={handleCancelAccepted} disabled={busy}>
                {busy ? "Rezygnuję…" : "Zrezygnuj z noclegu"}
              </button>
              <MeetingConfirmation request={myOutgoing} joinRequests={joinRequests} />
              {myOutgoing.meeting_confirmed_at && (
                <RateMatchForm
                  joinRequestId={myOutgoing.id}
                  kind="lodging"
                  raterAccountId={account.id}
                  ratedAccountId={myOutgoing.lodging_offers?.trips?.created_by_account_id}
                />
              )}
            </>
          )}
        </div>
      ) : showPicker ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {matchingTrips.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              Najpierw zgłoś wyjazd na {l.trips?.tournaments?.name ?? "ten turniej"} w{" "}
              <Link to={`/turnieje?turniej=${l.trips?.tournament_id ?? ""}`}>Turniejach</Link>.
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
                    {t.tournaments?.name ?? "Turniej"}
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
          Dołącz
        </button>
      )}
    </div>
  );
}

function AddLodgingForm({ trips, createOffer, onDone }) {
  const [kind, setKind] = useState("shared_booking");
  const [tripId, setTripId] = useState(trips[0]?.id ?? "");
  const [placeName, setPlaceName] = useState("");
  const [freeSpots, setFreeSpots] = useState(1);
  const [budgetPerNight, setBudgetPerNight] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (trips.length === 0) {
    return (
      <div className="glass-card">
        <p style={{ margin: "0 0 12px", fontSize: 13 }}>
          Najpierw zgłoś wyjazd na turniej — dopiero wtedy możesz dodać do niego ogłoszenie noclegowe.
        </p>
        <Link className="btn-primary" to="/turnieje">
          Wybierz turniej
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await createOffer({
      tripId,
      kind,
      placeName,
      freeSpots: Number(freeSpots) || null,
      budgetPerNight: budgetPerNight ? Number(budgetPerNight) : null,
      notes,
    });
    setBusy(false);
    if (error) {
      setError(error.message || "Nie udało się dodać ogłoszenia.");
      return;
    }
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="glass-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <label style={labelStyle}>Rodzaj</label>
        <div className="chip-row">
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`chip ${kind === value ? "is-active" : ""}`}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label style={labelStyle}>Który wyjazd?</label>
        <div className="chip-row">
          {trips.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`chip ${tripId === t.id ? "is-active" : ""}`}
              onClick={() => setTripId(t.id)}
            >
              {t.tournaments?.name ?? "Turniej"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label style={labelStyle}>Miejsce (opcjonalnie)</label>
        <input
          style={inputStyle}
          value={placeName}
          onChange={(e) => setPlaceName(e.target.value)}
          placeholder="np. Apartament 3-osobowy, 800m od kortów"
        />
      </div>
      <div>
        <label style={labelStyle}>Wolne miejsca (opcjonalnie)</label>
        <input style={inputStyle} type="number" min="1" value={freeSpots} onChange={(e) => setFreeSpots(e.target.value)} />
      </div>
      <div>
        <label style={labelStyle}>Budżet za noc/os. w zł (opcjonalnie)</label>
        <input
          style={inputStyle}
          type="number"
          min="0"
          value={budgetPerNight}
          onChange={(e) => setBudgetPerNight(e.target.value)}
        />
      </div>
      <div>
        <label style={labelStyle}>Uwagi (opcjonalnie)</label>
        <input style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      <button className="btn-primary" type="submit" disabled={busy}>
        {busy ? "Zapisuję…" : "Dodaj ogłoszenie"}
      </button>
    </form>
  );
}
