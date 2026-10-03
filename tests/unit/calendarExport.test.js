// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildTripICS, downloadICS } from "../../src/lib/calendarExport.js";

const trip = (over = {}) => ({
  id: "trip-1",
  departure_city: "Zabrze",
  tournaments: { name: "Turniej U12 Warszawa", city: "Warszawa", starts_on: "2026-10-20", ends_on: "2026-10-23" },
  players: { first_name: "Kuba", last_name: "Test" },
  ...over,
});

const lines = (ics) => ics.split("\r\n");
const field = (ics, name) => lines(ics).find((l) => l.startsWith(name));

describe("buildTripICS: struktura pliku", () => {
  it("zwraca poprawny kalendarz z jednym wydarzeniem", () => {
    const ics = buildTripICS(trip());
    expect(lines(ics)[0]).toBe("BEGIN:VCALENDAR");
    expect(lines(ics).at(-1)).toBe("END:VCALENDAR");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics.match(/END:VEVENT/g)).toHaveLength(1);
    expect(field(ics, "VERSION")).toBe("VERSION:2.0");
  });

  it("używa znaków końca linii CRLF zgodnie z RFC 5545", () => {
    const ics = buildTripICS(trip());
    expect(ics).toContain("\r\n");
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("UID jest stały dla wyjazdu (ponowny import nie dubluje wydarzenia)", () => {
    expect(field(buildTripICS(trip()), "UID")).toBe("UID:trip-1@tennis-together");
    expect(field(buildTripICS(trip()), "UID")).toBe(field(buildTripICS(trip()), "UID"));
    expect(field(buildTripICS(trip({ id: "trip-2" })), "UID")).toBe("UID:trip-2@tennis-together");
  });

  it("DTSTAMP ma format czasu UTC YYYYMMDDTHHMMSSZ", () => {
    expect(field(buildTripICS(trip()), "DTSTAMP")).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
  });
});

describe("buildTripICS: daty", () => {
  it("wydarzenie jest całodniowe, a koniec jest wyłączny (dzień po ostatnim dniu)", () => {
    const ics = buildTripICS(trip());
    expect(field(ics, "DTSTART")).toBe("DTSTART;VALUE=DATE:20261020");
    expect(field(ics, "DTEND")).toBe("DTEND;VALUE=DATE:20261024");
  });

  it("bez daty końca turniej trwa jeden dzień", () => {
    const ics = buildTripICS(trip({ tournaments: { name: "X", starts_on: "2026-10-20" } }));
    expect(field(ics, "DTSTART")).toBe("DTSTART;VALUE=DATE:20261020");
    expect(field(ics, "DTEND")).toBe("DTEND;VALUE=DATE:20261021");
  });

  it("koniec na granicy miesiąca i roku jest liczony poprawnie", () => {
    expect(field(buildTripICS(trip({ tournaments: { name: "X", starts_on: "2026-12-30", ends_on: "2026-12-31" } })), "DTEND")).toBe("DTEND;VALUE=DATE:20270101");
    expect(field(buildTripICS(trip({ tournaments: { name: "X", starts_on: "2026-10-30", ends_on: "2026-10-31" } })), "DTEND")).toBe("DTEND;VALUE=DATE:20261101");
  });

  it("rok przestępny: 28 lutego 2028 + 1 dzień = 29 lutego", () => {
    expect(field(buildTripICS(trip({ tournaments: { name: "X", starts_on: "2028-02-28", ends_on: "2028-02-28" } })), "DTEND")).toBe("DTEND;VALUE=DATE:20280229");
  });

  it("rok nieprzestępny: 28 lutego 2027 + 1 dzień = 1 marca", () => {
    expect(field(buildTripICS(trip({ tournaments: { name: "X", starts_on: "2027-02-28", ends_on: "2027-02-28" } })), "DTEND")).toBe("DTEND;VALUE=DATE:20270301");
  });

  it("data z częścią czasową (ISO) jest obcinana do dnia", () => {
    const ics = buildTripICS(trip({ tournaments: { name: "X", starts_on: "2026-10-20T00:00:00+00:00", ends_on: "2026-10-22T00:00:00+00:00" } }));
    expect(field(ics, "DTSTART")).toBe("DTSTART;VALUE=DATE:20261020");
    expect(field(ics, "DTEND")).toBe("DTEND;VALUE=DATE:20261023");
  });

  it("brak daty startu turnieju: brak pliku (null)", () => {
    expect(buildTripICS(trip({ tournaments: { name: "X" } }))).toBeNull();
    expect(buildTripICS(trip({ tournaments: null }))).toBeNull();
    expect(buildTripICS({ id: "x" })).toBeNull();
  });
});

describe("buildTripICS: treść i znaki specjalne", () => {
  it("nazwa turnieju, miasto i zawodnik trafiają do pól", () => {
    const ics = buildTripICS(trip());
    expect(field(ics, "SUMMARY")).toContain("Turniej U12 Warszawa");
    expect(field(ics, "LOCATION")).toBe("LOCATION:Warszawa");
    expect(field(ics, "DESCRIPTION")).toContain("Zawodnik: Kuba Test");
    expect(field(ics, "DESCRIPTION")).toContain("Wyjazd z: Zabrze");
  });

  it("przecinki, średniki i ukośniki w tekście są poprawnie zakodowane", () => {
    const ics = buildTripICS(trip({ tournaments: { name: "Memoriał A, B; C \\ D", city: "Bielsko-Biała, PL", starts_on: "2026-10-20" } }));
    expect(field(ics, "SUMMARY")).toContain("Memoriał A\\, B\\; C \\\\ D");
    expect(field(ics, "LOCATION")).toBe("LOCATION:Bielsko-Biała\\, PL");
  });

  it("znaki nowej linii w treści nie psują struktury pliku", () => {
    const ics = buildTripICS(trip({ tournaments: { name: "Linia1\nLinia2\r\nLinia3", starts_on: "2026-10-20" } }));
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(field(ics, "SUMMARY")).toContain("Linia1\\nLinia2\\nLinia3");
  });

  it("wstrzyknięcie linii kalendarza przez nazwę turnieju jest niemożliwe", () => {
    const evil = "Test\r\nBEGIN:VALARM\r\nACTION:EMAIL\r\nEND:VALARM";
    const ics = buildTripICS(trip({ tournaments: { name: evil, starts_on: "2026-10-20" } }));
    // tekst jest zakodowany w jednej linii (\n), więc żadna linia pliku nie zaczyna się od wstrzykniętego ACTION
    expect(lines(ics).filter((l) => l.startsWith("ACTION:EMAIL"))).toEqual([]);
    expect(lines(ics).filter((l) => l === "BEGIN:VALARM")).toHaveLength(1);
  });

  it("bez miasta turnieju brak pola LOCATION", () => {
    expect(field(buildTripICS(trip({ tournaments: { name: "X", starts_on: "2026-10-20" } })), "LOCATION")).toBeUndefined();
  });

  it("bez danych zawodnika opis nadal zawiera informację o aplikacji", () => {
    const ics = buildTripICS(trip({ players: null }));
    expect(field(ics, "DESCRIPTION")).toContain("Zaplanowane w Tennis Together");
    expect(field(ics, "DESCRIPTION")).not.toContain("Zawodnik:");
  });

  it("zawiera przypomnienie dzień przed turniejem", () => {
    const ics = buildTripICS(trip());
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("TRIGGER:-P1D");
    expect(ics).toContain("ACTION:DISPLAY");
  });

  it("polskie znaki i emoji są zachowane", () => {
    const ics = buildTripICS(trip({ tournaments: { name: "Memoriał Łódź ąęśćżźńó", starts_on: "2026-10-20" } }));
    expect(ics).toContain("Memoriał Łódź ąęśćżźńó");
    expect(field(ics, "SUMMARY")).toContain("🎾");
  });
});

describe("downloadICS", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("tworzy link do pobrania z podaną nazwą pliku i typem text/calendar", () => {
    const created = [];
    globalThis.URL.createObjectURL = vi.fn((b) => (created.push(b), "blob:test"));
    globalThis.URL.revokeObjectURL = vi.fn();
    let clicked = null;
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicked = { download: this.download, href: this.href };
    };
    downloadICS("wyjazd-2026-10-20.ics", "BEGIN:VCALENDAR\r\nEND:VCALENDAR");
    HTMLAnchorElement.prototype.click = origClick;
    expect(clicked.download).toBe("wyjazd-2026-10-20.ics");
    expect(clicked.href).toBe("blob:test");
    expect(created[0].type).toMatch(/^text\/calendar/);
  });

  it("po pobraniu sprząta element i zwalnia adres blob", async () => {
    vi.useFakeTimers();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
    globalThis.URL.revokeObjectURL = vi.fn();
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = () => {};
    downloadICS("a.ics", "x");
    expect(document.querySelectorAll("a[download]").length).toBe(1);
    vi.advanceTimersByTime(2000);
    HTMLAnchorElement.prototype.click = origClick;
    expect(document.querySelectorAll("a[download]").length).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    vi.useRealTimers();
  });
});
