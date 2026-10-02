import { lazy, Suspense, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { useCityCoordinates, findCityCoords } from "../lib/useCityCoordinates.js";
import ErrorBox from "./ErrorBox.jsx";
import { inputStyle } from "./formStyles.js";

// Mapa (Leaflet) jest ciężka i potrzebna dopiero po zaakceptowaniu przejazdu,
// więc ładujemy ją leniwie — główny pakiet aplikacji się nie powiększa.
const LeafletMap = lazy(() => import("./LeafletMap.jsx"));

const POLAND_CENTER = [52.0, 19.4];

function mapsLink(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

// Pineska "gdzie się spotykamy" (0036_meeting_point.sql) — widoczna dla obu
// stron zaakceptowanego przejazdu / prośby o podwiezienie; obie mogą ją
// ustawić i zmienić. `kind`: "ride" | "ride_ping". `centerCity`: miasto wyjazdu,
// żeby mapa nie startowała z widoku całej Polski.
export default function MeetingPoint({ kind, request, onSaved, centerCity }) {
  const { cities } = useCityCoordinates();
  const centerHint = findCityCoords(cities, centerCity);
  const hasPin = request.meeting_lat != null && request.meeting_lng != null;
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState(null);
  const [place, setPlace] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const startEdit = () => {
    setPin(hasPin ? { lat: request.meeting_lat, lng: request.meeting_lng } : null);
    setPlace(request.meeting_place ?? "");
    setQuery("");
    setError(null);
    setEditing(true);
  };

  const save = async (clear) => {
    if (!clear && !pin) {
      setError("Kliknij w mapę, żeby postawić pineskę, albo wyszukaj adres.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("set_meeting_point", {
      p_kind: kind,
      p_request_id: request.id,
      p_lat: clear ? null : pin.lat,
      p_lng: clear ? null : pin.lng,
      p_place: clear ? null : place,
    });
    setBusy(false);
    if (rpcError) {
      setError("Nie udało się zapisać miejsca spotkania. Spróbuj ponownie.");
      return;
    }
    if (data?.result !== "ok") {
      setError(
        data?.result === "forbidden"
          ? "Miejsce można ustawić tylko przy zaakceptowanym przejeździe."
          : "Nieprawidłowe miejsce na mapie."
      );
      return;
    }
    setEditing(false);
    await onSaved?.();
  };

  // Wyszukiwanie adresu (Nominatim/OpenStreetMap) — tylko na żądanie, po
  // kliknięciu przycisku, bo ich regulamin zabrania zapytań "w trakcie pisania".
  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=pl&q=${encodeURIComponent(q)}`,
        { headers: { Accept: "application/json" } }
      );
      const results = await res.json();
      if (!results?.length) {
        setError("Nie znaleziono takiego adresu. Spróbuj inaczej albo kliknij w mapę.");
      } else {
        const r = results[0];
        setPin({ lat: parseFloat(r.lat), lng: parseFloat(r.lon) });
        if (!place.trim()) setPlace((r.display_name ?? q).split(",").slice(0, 2).join(",").trim());
      }
    } catch {
      setError("Wyszukiwanie adresu nie działa. Kliknij w mapę, żeby postawić pineskę.");
    }
    setBusy(false);
  };

  if (editing) {
    const center = pin ? [pin.lat, pin.lng] : centerHint ? [centerHint.lat, centerHint.lng] : POLAND_CENTER;
    const zoom = pin ? 16 : centerHint ? 11 : 6;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>📍 Gdzie się spotykacie?</p>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            placeholder="Wyszukaj adres, np. Zabrze, Wolności 1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), search())}
          />
          <button type="button" className="btn-ghost" onClick={search} disabled={busy}>
            Szukaj
          </button>
        </div>
        <Suspense fallback={<p style={{ margin: 0, fontSize: 13 }}>Ładowanie mapy…</p>}>
          <LeafletMap
            center={center}
            zoom={zoom}
            marker={pin}
            height={260}
            onPick={(lat, lng) => setPin({ lat, lng })}
          />
        </Suspense>
        <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-muted)" }}>
          Kliknij w mapę, żeby postawić pineskę. Możesz ją potem przeciągnąć.
        </p>
        <input
          style={inputStyle}
          maxLength={120}
          placeholder="Opis miejsca (opcjonalnie), np. parking pod Biedronką"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
        />
        {error && <ErrorBox>{error}</ErrorBox>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn-primary" onClick={() => save(false)} disabled={busy}>
            {busy ? "Zapisuję…" : "Zapisz miejsce"}
          </button>
          {hasPin && (
            <button type="button" className="btn-ghost" onClick={() => save(true)} disabled={busy}>
              Usuń pineskę
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={() => setEditing(false)} disabled={busy}>
            Anuluj
          </button>
        </div>
      </div>
    );
  }

  if (!hasPin) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>📍 Miejsce spotkania jeszcze nie ustalone</span>
        <button type="button" className="btn-ghost" onClick={startEdit}>
          Ustaw miejsce spotkania
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
        📍 Miejsce spotkania{request.meeting_place ? `: ${request.meeting_place}` : ""}
      </p>
      <Suspense fallback={<p style={{ margin: 0, fontSize: 13 }}>Ładowanie mapy…</p>}>
        <LeafletMap
          center={[request.meeting_lat, request.meeting_lng]}
          zoom={15}
          marker={{ lat: request.meeting_lat, lng: request.meeting_lng }}
          height={150}
        />
      </Suspense>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <a
          className="btn-ghost"
          href={mapsLink(request.meeting_lat, request.meeting_lng)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Otwórz w mapach
        </a>
        <button type="button" className="btn-ghost" onClick={startEdit}>
          Zmień miejsce
        </button>
      </div>
    </div>
  );
}
