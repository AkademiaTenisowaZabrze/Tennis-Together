// Eksport wyjazdu do kalendarza telefonu (.ics) — całodniowe wydarzenie na
// czas turnieju z przypomnieniem dzień wcześniej. Ten sam mechanizm
// pobierania (Blob + <a download>) co w apce PZT Rankingi.

const pad = (n) => String(n).padStart(2, "0");

// "YYYY-MM-DD" -> "YYYYMMDD", opcjonalnie przesunięte o N dni (bez stref
// czasowych — liczymy na UTC, żeby lokalna północ nie zjadała dnia).
function icsDate(isoDate, addDays = 0) {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + addDays));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

function esc(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/([,;])/g, "\\$1")
    .replace(/\r?\n/g, "\\n");
}

export function buildTripICS(trip) {
  const t = trip.tournaments;
  if (!t?.starts_on) return null;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  // DTEND w całodniowych wydarzeniach jest wyłączny — dzień po ostatnim dniu.
  const lastDay = t.ends_on || t.starts_on;
  const player = [trip.players?.first_name, trip.players?.last_name].filter(Boolean).join(" ");
  const description = [
    player && `Zawodnik: ${player}`,
    trip.departure_city && `Wyjazd z: ${trip.departure_city}`,
    "Zaplanowane w Tennis Together",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tennis Together//PL",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${trip.id}@tennis-together`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icsDate(t.starts_on)}`,
    `DTEND;VALUE=DATE:${icsDate(lastDay, 1)}`,
    `SUMMARY:${esc(`🎾 ${t.name}`)}`,
    t.city ? `LOCATION:${esc(t.city)}` : null,
    `DESCRIPTION:${esc(description)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(`Jutro turniej: ${t.name}`)}`,
    "TRIGGER:-P1D",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

export function downloadICS(filename, content) {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
}
