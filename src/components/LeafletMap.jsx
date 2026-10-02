import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Domyślne ikony Leaflet zakładają swoje ścieżki do obrazków, które po
// zbudowaniu przez Vite nie istnieją — podajemy je jawnie z importów.
// Bez tego Leaflet dokleja do podanych adresów własną, wykrytą ścieżkę i
// ikona pineski pokazuje się jako uszkodzony obrazek.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

// Mapa OpenStreetMap z jedną pineską. `onPick` włącza tryb edycji: kliknięcie
// w mapę stawia pineskę, pineskę można też przeciągnąć. Bez `onPick` mapa jest
// tylko do podglądu (bez przesuwania i przybliżania, żeby nie "kradła"
// przewijania strony na telefonie). Ładowana leniwie (patrz MeetingPoint.jsx),
// więc biblioteka nie powiększa głównego pakietu aplikacji.
export default function LeafletMap({ center, zoom = 14, marker, onPick, height = 180 }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const interactive = !!onPick;

  useEffect(() => {
    const map = L.map(elRef.current, {
      center,
      zoom,
      dragging: interactive,
      touchZoom: interactive,
      scrollWheelZoom: false,
      doubleClickZoom: interactive,
      boxZoom: false,
      keyboard: false,
      zoomControl: interactive,
      attributionControl: true,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    if (interactive) {
      map.on("click", (e) => onPickRef.current?.(e.latlng.lat, e.latlng.lng));
    }
    mapRef.current = map;
    // Mapa startuje w kontenerze, który dopiero się układa — bez tego kafelki
    // bywają przycięte do części widoku.
    const t = setTimeout(() => map.invalidateSize(), 50);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!marker) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const latlng = [marker.lat, marker.lng];
    if (markerRef.current) {
      markerRef.current.setLatLng(latlng);
    } else {
      const m = L.marker(latlng, { draggable: interactive }).addTo(map);
      if (interactive) {
        m.on("dragend", () => {
          const p = m.getLatLng();
          onPickRef.current?.(p.lat, p.lng);
        });
      }
      markerRef.current = m;
    }
    map.setView(latlng, Math.max(map.getZoom(), zoom));
  }, [marker?.lat, marker?.lng, interactive, zoom]);

  return <div ref={elRef} style={{ height, width: "100%", borderRadius: 12, overflow: "hidden", zIndex: 0 }} />;
}
