// Odległości, dopasowanie miast oraz weryfikacja loginu PZT (porównanie imion).
import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("../../src/lib/supabase.js", () => ({ supabase: { functions: { invoke: (...a) => invoke(...a) } } }));

const { findCityCoords, haversineKm } = await import("../../src/lib/useCityCoordinates.js");
const { verifyPztLogin } = await import("../../src/lib/usePztPlayerSearch.js");

const CITIES = [
  { city: "Zabrze", lat: 50.32, lng: 18.78 },
  { city: "Gdańsk", lat: 54.35, lng: 18.65 },
  { city: "Kraków", lat: 50.06, lng: 19.94 },
  { city: "Warszawa", lat: 52.23, lng: 21.01 },
  { city: "Łódź", lat: 51.76, lng: 19.46 },
  { city: "Zielona Gora", lat: 51.94, lng: 15.51 }, // literówka w danych źródłowych (bez ogonka)
];

describe("findCityCoords", () => {
  it("znajduje miasto po dokładnej nazwie", () => {
    expect(findCityCoords(CITIES, "Zabrze")).toEqual({ lat: 50.32, lng: 18.78 });
  });

  it("ignoruje wielkość liter i spacje po bokach", () => {
    for (const v of ["zabrze", "ZABRZE", "  Zabrze  ", "zAbRzE"]) expect(findCityCoords(CITIES, v), v).toEqual({ lat: 50.32, lng: 18.78 });
  });

  it("ignoruje polskie znaki w nazwie wpisanej przez użytkownika", () => {
    expect(findCityCoords(CITIES, "Gdansk")).not.toBeNull();
    expect(findCityCoords(CITIES, "Krakow")).not.toBeNull();
    expect(findCityCoords(CITIES, "Lodz")).not.toBeNull();
    expect(findCityCoords(CITIES, "ŁÓDŹ")).not.toBeNull();
  });

  it("dopasowuje miasto zapisane w danych bez ogonków, gdy użytkownik wpisze z ogonkami", () => {
    expect(findCityCoords(CITIES, "Zielona Góra")).toEqual({ lat: 51.94, lng: 15.51 });
  });

  it("nieznane miasto, puste pole i brak wartości: null", () => {
    expect(findCityCoords(CITIES, "Atlantyda")).toBeNull();
    expect(findCityCoords(CITIES, "")).toBeNull();
    expect(findCityCoords(CITIES, null)).toBeNull();
    expect(findCityCoords(CITIES, undefined)).toBeNull();
    expect(findCityCoords([], "Zabrze")).toBeNull();
  });

  it("nie dopasowuje częściowych nazw (Zabrz, Zabrze Północ)", () => {
    expect(findCityCoords(CITIES, "Zabrz")).toBeNull();
    expect(findCityCoords(CITIES, "Zabrze Północ")).toBeNull();
  });
});

describe("haversineKm", () => {
  const d = (a, b) => haversineKm(a.lat, a.lng, b.lat, b.lng);
  const by = Object.fromEntries(CITIES.map((c) => [c.city, c]));

  it("zero kilometrów dla tego samego punktu", () => {
    expect(haversineKm(50, 18, 50, 18)).toBe(0);
  });

  it("symetria: A→B = B→A", () => {
    expect(d(by.Zabrze, by.Gdańsk)).toBeCloseTo(d(by.Gdańsk, by.Zabrze), 9);
  });

  it("znane odległości w linii prostej są zbliżone do rzeczywistych", () => {
    expect(d(by.Warszawa, by.Kraków)).toBeGreaterThan(240);
    expect(d(by.Warszawa, by.Kraków)).toBeLessThan(260);
    expect(d(by.Zabrze, by.Gdańsk)).toBeGreaterThan(440);
    expect(d(by.Zabrze, by.Gdańsk)).toBeLessThan(470);
    expect(d(by.Warszawa, by.Łódź)).toBeGreaterThan(110);
    expect(d(by.Warszawa, by.Łódź)).toBeLessThan(125);
  });

  it("nierówność trójkąta: dłużej przez punkt pośredni niż prosto", () => {
    expect(d(by.Zabrze, by.Gdańsk)).toBeLessThanOrEqual(d(by.Zabrze, by.Łódź) + d(by.Łódź, by.Gdańsk) + 1e-9);
  });

  it("stopień szerokości to ok. 111 km", () => {
    expect(haversineKm(50, 18, 51, 18)).toBeGreaterThan(110);
    expect(haversineKm(50, 18, 51, 18)).toBeLessThan(112);
  });

  it("przeciwległe punkty Ziemi dają ok. 20 000 km, bez wartości NaN", () => {
    const v = haversineKm(0, 0, 0, 180);
    expect(Number.isNaN(v)).toBe(false);
    expect(v).toBeGreaterThan(20000);
    expect(v).toBeLessThan(20040);
  });

  it("wynik jest zawsze nieujemny", () => {
    for (const [a, b] of [[by.Zabrze, by.Kraków], [by.Gdańsk, by.Warszawa], [by.Łódź, by.Zabrze]]) expect(d(a, b)).toBeGreaterThan(0);
  });
});

describe("verifyPztLogin: porównanie imion", () => {
  beforeEach(() => invoke.mockReset());
  const pzt = (name) => invoke.mockResolvedValue({ data: { player_name: name }, error: null });

  it("wywołuje funkcję pzt-player-lookup z loginem", async () => {
    pzt("Mroczek Wiktor");
    await verifyPztLogin("MRO2043343", "Wiktor", "Mroczek");
    expect(invoke).toHaveBeenCalledWith("pzt-player-lookup", { body: { login: "MRO2043343" } });
  });

  it("zgodne dane (PZT podaje 'Nazwisko Imię')", async () => {
    pzt("Mroczek Wiktor");
    const r = await verifyPztLogin("MRO2043343", "Wiktor", "Mroczek");
    expect(r).toEqual({ found: true, pztName: "Mroczek Wiktor", matches: true });
  });

  it("kolejność imienia i nazwiska nie ma znaczenia", async () => {
    pzt("Wiktor Mroczek");
    expect((await verifyPztLogin("X", "Wiktor", "Mroczek")).matches).toBe(true);
  });

  it("wielkość liter i polskie znaki nie mają znaczenia", async () => {
    pzt("ŁĄCKI Józef");
    expect((await verifyPztLogin("X", "jozef", "lacki")).matches).toBe(true);
  });

  it("nazwisko dwuczłonowe wpisane w profilu pasuje do jednego członu w PZT", async () => {
    pzt("Kowalska Anna");
    expect((await verifyPztLogin("X", "Anna", "Kowalska Nowak")).matches).toBe(true);
  });

  it("inne imię: niezgodne", async () => {
    pzt("Mroczek Wiktor");
    expect((await verifyPztLogin("X", "Jakub", "Mroczek")).matches).toBe(false);
  });

  it("inne nazwisko: niezgodne", async () => {
    pzt("Mroczek Wiktor");
    expect((await verifyPztLogin("X", "Wiktor", "Nowak")).matches).toBe(false);
  });

  it("PZT zwraca dodatkowe słowo, którego nie ma w profilu: niezgodne (zabezpieczenie przed podszyciem)", async () => {
    pzt("Mroczek Wiktor Paweł");
    expect((await verifyPztLogin("X", "Wiktor", "Mroczek")).matches).toBe(false);
  });

  it("samo imię lub samo nazwisko w profilu nie wystarczy, gdy PZT ma oba", async () => {
    pzt("Mroczek Wiktor");
    expect((await verifyPztLogin("X", "Wiktor", "")).matches).toBe(false);
  });

  it("login nieznany w PZT: found=false, bez dopasowania", async () => {
    invoke.mockResolvedValue({ data: { player_name: null, found: false }, error: null });
    expect(await verifyPztLogin("ZZZ", "A", "B")).toEqual({ found: false, pztName: null, matches: false });
  });

  it("pusta odpowiedź serwera: found=false", async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    expect((await verifyPztLogin("X", "A", "B")).found).toBe(false);
  });

  it("błąd serwera zamienia się na czytelny komunikat", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(verifyPztLogin("X", "A", "B")).rejects.toThrow(/Serwer PZT odpowiedział błędem/);
  });

  it("pusta nazwa z PZT nie daje dopasowania", async () => {
    pzt("   ");
    const r = await verifyPztLogin("X", "A", "B");
    expect(r.matches).toBe(false);
  });
});
