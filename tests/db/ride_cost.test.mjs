// Kalkulator kosztów przejazdu (migracje 0041, 0042): poprawność liczenia,
// dostęp do wyniku oraz mechanizm zgody kierowcy na ofercie.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { openDb, isDenied } from "../helpers/db.mjs";

let db;
beforeAll(async () => {
  db = await openDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

// Niezależna implementacja wzoru (nie kopiuje SQL, liczy po swojemu).
function reference(from, to, s) {
  const rad = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(to.lat - from.lat) / 2) ** 2 +
    Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(rad(to.lng - from.lng) / 2) ** 2;
  const km = 2 * 6371 * Math.asin(Math.sqrt(a)) * s.road_factor;
  const total = km * (s.round_trip ? 2 : 1) * (s.consumption / 100) * s.fuel;
  const per = Math.max(s.round_to, Math.round(total / s.divisor / s.round_to) * s.round_to);
  return { km: Math.round(km), per };
}

async function coords(city) {
  const r = await db.sql(`select lat, lng from city_coordinates where city = '${city}'`);
  return r.rows[0];
}

const DEFAULTS = { consumption: 6.5, fuel: 8.1, road_factor: 1.25, round_trip: true, divisor: 4, round_to: 5 };

async function suggestionFor(fromCity, toCity, as, opts = {}) {
  const t = await db.tournament({ city: toCity, ...opts.tournament });
  const fam = await db.family(t, { city: fromCity });
  const asUid = as ?? fam.account;
  const rows = await db.as(asUid).q(`select * from ride_cost_suggestion('${fam.trip}')`);
  return { rows, fam, t };
}

describe("wzór kalkulatora", () => {
  const ROUTES = [
    ["Zabrze", "Warszawa"],
    ["Zabrze", "Gdańsk"],
    ["Katowice", "Kraków"],
    ["Warszawa", "Szczecin"],
    ["Wrocław", "Poznań"],
    ["Gdańsk", "Zabrze"],
  ];

  for (const [from, to] of ROUTES) {
    it(`trasa ${from} → ${to}: wynik zgodny z niezależnym wyliczeniem`, async () => {
      const { rows } = await suggestionFor(from, to);
      const exp = reference(await coords(from), await coords(to), DEFAULTS);
      expect(rows.length).toBe(1);
      expect(rows[0].distance_km).toBe(exp.km);
      expect(rows[0].per_person_pln).toBe(exp.per);
    });
  }

  it("odległość jest symetryczna (tam i z powrotem ta sama)", async () => {
    const a = (await suggestionFor("Zabrze", "Gdańsk")).rows[0];
    const b = (await suggestionFor("Gdańsk", "Zabrze")).rows[0];
    expect(a.distance_km).toBe(b.distance_km);
  });

  const SETTINGS = [
    { consumption_l_per_100km: 5, fuel_price_pln: 6, road_factor: 1.1, round_trip: false, share_divisor: 3, round_to_pln: 1 },
    { consumption_l_per_100km: 9, fuel_price_pln: 9.5, road_factor: 1.4, round_trip: true, share_divisor: 2, round_to_pln: 10 },
    { consumption_l_per_100km: 7, fuel_price_pln: 8, road_factor: 1.25, round_trip: true, share_divisor: 5, round_to_pln: 5 },
    { consumption_l_per_100km: 6.5, fuel_price_pln: 8.1, road_factor: 1, round_trip: false, share_divisor: 1, round_to_pln: 50 },
  ];
  SETTINGS.forEach((s, i) => {
    it(`zmiana parametrów (zestaw ${i + 1}) zmienia wynik zgodnie ze wzorem`, async () => {
      await db.exec(
        `update ride_cost_settings set consumption_l_per_100km = ${s.consumption_l_per_100km}, fuel_price_pln = ${s.fuel_price_pln},
         road_factor = ${s.road_factor}, round_trip = ${s.round_trip}, share_divisor = ${s.share_divisor}, round_to_pln = ${s.round_to_pln}`
      );
      const { rows } = await suggestionFor("Zabrze", "Gdańsk");
      const exp = reference(await coords("Zabrze"), await coords("Gdańsk"), {
        consumption: s.consumption_l_per_100km, fuel: s.fuel_price_pln, road_factor: s.road_factor,
        round_trip: s.round_trip, divisor: s.share_divisor, round_to: s.round_to_pln,
      });
      expect(rows[0].per_person_pln).toBe(exp.per);
      expect(rows[0].distance_km).toBe(exp.km);
    });
  });

  it("droższe paliwo nigdy nie obniża kwoty", async () => {
    await db.exec(`update ride_cost_settings set fuel_price_pln = 6`);
    const low = (await suggestionFor("Zabrze", "Gdańsk")).rows[0].per_person_pln;
    await db.exec(`update ride_cost_settings set fuel_price_pln = 12`);
    const high = (await suggestionFor("Zabrze", "Gdańsk")).rows[0].per_person_pln;
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it("wynik jest wielokrotnością zaokrąglenia i nigdy mniejszy niż jedno zaokrąglenie", async () => {
    for (const round of [1, 5, 10, 25]) {
      await db.exec(`update ride_cost_settings set round_to_pln = ${round}`);
      const { rows } = await suggestionFor("Zabrze", "Gliwice");
      expect(rows[0].per_person_pln % round).toBe(0);
      expect(rows[0].per_person_pln).toBeGreaterThanOrEqual(round);
    }
  });

  it("ta sama miejscowość (dystans zero) daje minimalną kwotę, nie zero ani błąd", async () => {
    const { rows } = await suggestionFor("Zabrze", "Zabrze");
    expect(rows[0].distance_km).toBe(0);
    expect(rows[0].per_person_pln).toBe(5);
  });

  it("liczy się z własnych współrzędnych turnieju i wyjazdu, gdy są podane", async () => {
    const t = await db.tournament({ city: "Miejscowość spoza listy" });
    await db.exec(`update tournaments set lat = 54.35, lng = 18.65 where id = '${t}'`);
    const fam = await db.family(t, { city: "Wieś spoza listy" });
    await db.exec(`update trips set departure_lat = 50.32, departure_lng = 18.78 where id = '${fam.trip}'`);
    const rows = await db.as(fam.account).q(`select * from ride_cost_suggestion('${fam.trip}')`);
    expect(rows.length).toBe(1);
    const exp = reference({ lat: 50.32, lng: 18.78 }, { lat: 54.35, lng: 18.65 }, DEFAULTS);
    expect(rows[0].per_person_pln).toBe(exp.per);
  });

  it("nazwa miasta jest dopasowana bez polskich znaków, wielkości liter i spacji", async () => {
    const exact = (await suggestionFor("Gdańsk", "Warszawa")).rows[0];
    for (const variant of ["Gdansk", "GDAŃSK", " gdańsk ", "gdansk"]) {
      const v = (await suggestionFor(variant, "Warszawa")).rows;
      expect(v.length, variant).toBe(1);
      expect(v[0].distance_km, variant).toBe(exact.distance_km);
    }
  });

  it("miasto spoza listy bez współrzędnych: brak wyniku (nie błąd, nie zero)", async () => {
    const { rows } = await suggestionFor("Wieś Nieistniejąca", "Warszawa");
    expect(rows).toEqual([]);
  });

  it("turniej w nieznanym mieście bez współrzędnych: brak wyniku", async () => {
    const { rows } = await suggestionFor("Zabrze", "Miasto Nieistniejące");
    expect(rows).toEqual([]);
  });
});

describe("kto może zobaczyć wynik", () => {
  it("właściciel wyjazdu widzi wynik", async () => {
    expect((await suggestionFor("Zabrze", "Warszawa")).rows.length).toBe(1);
  });

  it("obcy bez oferty na tym wyjeździe nie widzi wyniku", async () => {
    const t = await db.tournament({ city: "Warszawa" });
    const owner = await db.family(t, { city: "Zabrze" });
    const stranger = await db.user();
    expect(await db.as(stranger).q(`select * from ride_cost_suggestion('${owner.trip}')`)).toEqual([]);
  });

  it("obcy widzi wynik, gdy wyjazd ma ofertę przejazdu (ogłoszenie jest publiczne)", async () => {
    const t = await db.tournament({ city: "Warszawa" });
    const owner = await db.family(t, { city: "Zabrze" });
    await db.rideOffer(owner.trip, owner.account);
    const stranger = await db.user();
    expect((await db.as(stranger).q(`select * from ride_cost_suggestion('${owner.trip}')`)).length).toBe(1);
  });

  it("anonim nie wywoła kalkulatora", async () => {
    const t = await db.tournament({ city: "Warszawa" });
    const owner = await db.family(t, { city: "Zabrze" });
    await db.rideOffer(owner.trip, owner.account);
    const r = await db.anon().try(`select * from ride_cost_suggestion('${owner.trip}')`);
    expect(r.error !== null || r.rows.length === 0).toBe(true);
  });

  it("nieistniejący wyjazd: pusta odpowiedź, bez błędu", async () => {
    const u = await db.user();
    const r = await db.as(u).try(`select * from ride_cost_suggestion(gen_random_uuid())`);
    expect(r.error).toBeNull();
    expect(r.rows).toEqual([]);
  });

  it("wynik nie zdradza parametrów kalkulatora (tylko kilometry i kwota)", async () => {
    const { rows } = await suggestionFor("Zabrze", "Warszawa");
    expect(Object.keys(rows[0]).sort()).toEqual(["distance_km", "per_person_pln"]);
  });
});

describe("oferta przejazdu: wybór kierowcy i zgoda na kwotę", () => {
  let t, fam;
  beforeEach(async () => {
    t = await db.tournament({ city: "Warszawa" });
    fam = await db.family(t, { city: "Zabrze" });
  });
  const insertOffer = (cols, vals) =>
    db.as(fam.account).try(`insert into ride_offers(trip_id, free_seats${cols}) values ('${fam.trip}', 2${vals}) returning *`);

  it("oferta bez zwrotu kosztów nie ma kwoty ani zgody", async () => {
    const r = await insertOffer("", "");
    expect(r.rows[0].cost_refund).toBe(false);
    expect(r.rows[0].cost_per_person_pln).toBeNull();
    expect(r.rows[0].cost_terms_accepted).toBe(false);
  });

  it("zwrot kosztów bez zaznaczenia zgody jest odrzucony", async () => {
    const r = await insertOffer(", cost_refund", ", true");
    expect(r.error).not.toBeNull();
  });

  it("zwrot kosztów ze zgodą dostaje kwotę z kalkulatora i datę zgody", async () => {
    const r = await insertOffer(", cost_refund, cost_terms_accepted", ", true, true");
    expect(r.error).toBeNull();
    const calc = (await db.as(fam.account).q(`select per_person_pln from ride_cost_suggestion('${fam.trip}')`))[0].per_person_pln;
    expect(r.rows[0].cost_per_person_pln).toBe(calc);
    expect(r.rows[0].cost_terms_accepted_at).not.toBeNull();
  });

  it("kierowca nie może narzucić własnej kwoty", async () => {
    const calc = (await db.as(fam.account).q(`select per_person_pln from ride_cost_suggestion('${fam.trip}')`))[0].per_person_pln;
    const r = await insertOffer(", cost_refund, cost_terms_accepted, cost_per_person_pln", ", true, true, 499");
    expect(r.rows[0].cost_per_person_pln).toBe(calc);
  });

  it("bez zwrotu kosztów wpisana kwota jest ignorowana", async () => {
    const r = await insertOffer(", cost_per_person_pln, cost_terms_accepted", ", 300, true");
    expect(r.rows[0].cost_per_person_pln).toBeNull();
    expect(r.rows[0].cost_terms_accepted).toBe(false);
  });

  it("dla trasy bez możliwości wyliczenia zwrot kosztów jest odrzucony z jasnym komunikatem", async () => {
    const fam2 = await db.family(t, { city: "Wieś Nieistniejąca" });
    const r = await db.as(fam2.account).try(
      `insert into ride_offers(trip_id, free_seats, cost_refund, cost_terms_accepted) values ('${fam2.trip}', 2, true, true)`
    );
    expect(r.error?.message).toMatch(/Nie można wyliczyć kwoty/);
  });

  it("kwota i zgoda są zamrożone po utworzeniu oferty", async () => {
    const created = (await insertOffer(", cost_refund, cost_terms_accepted", ", true, true")).rows[0];
    await db.as(fam.account).try(`update ride_offers set cost_per_person_pln = 1, cost_refund = false, cost_terms_accepted = false where id = '${created.id}'`);
    const stored = (await db.sql(`select cost_per_person_pln, cost_refund, cost_terms_accepted from ride_offers where id = '${created.id}'`)).rows[0];
    expect(stored.cost_per_person_pln).toBe(created.cost_per_person_pln);
    expect(stored.cost_refund).toBe(true);
    expect(stored.cost_terms_accepted).toBe(true);
  });

  it("zmiana parametrów przez administratora nie zmienia kwoty istniejącej oferty", async () => {
    const created = (await insertOffer(", cost_refund, cost_terms_accepted", ", true, true")).rows[0];
    await db.exec(`update ride_cost_settings set fuel_price_pln = 15, round_to_pln = 50`);
    const stored = (await db.sql(`select cost_per_person_pln from ride_offers where id = '${created.id}'`)).rows[0].cost_per_person_pln;
    expect(stored).toBe(created.cost_per_person_pln);
  });

  it("nieprawidłowe kwoty (ujemna, ponad 500 zł) nie trafiają do bazy, wartość zostaje bez zmian", async () => {
    const created = (await insertOffer(", cost_refund, cost_terms_accepted", ", true, true")).rows[0];
    for (const bad of [-1, 501, 100000]) {
      await db.sql(`update ride_offers set cost_per_person_pln = ${bad} where id = '${created.id}'`);
      const stored = (await db.sql(`select cost_per_person_pln from ride_offers where id = '${created.id}'`)).rows[0].cost_per_person_pln;
      expect(stored, String(bad)).toBe(created.cost_per_person_pln);
    }
  });

  it("obcy nie dopisze oferty do cudzego wyjazdu", async () => {
    const stranger = await db.user();
    const r = await db.as(stranger).try(`insert into ride_offers(trip_id, free_seats, cost_refund, cost_terms_accepted) values ('${fam.trip}', 2, true, true)`);
    expect(r.error).not.toBeNull();
  });

  it("zawieszone konto nie dodaje ofert", async () => {
    await db.exec(`update accounts set status = 'suspended' where id = '${fam.account}'`);
    expect((await insertOffer("", "")).error).not.toBeNull();
  });
});

describe("ceny paliwa w ustawieniach", () => {
  it("rodzaj paliwa przyjmuje tylko pb95, diesel, lpg", async () => {
    for (const ok of ["pb95", "diesel", "lpg"]) {
      expect((await db.sql(`update ride_cost_settings set fuel_type = '${ok}'`)).error, ok).toBeNull();
    }
    expect((await db.sql(`update ride_cost_settings set fuel_type = 'benzyna'`)).error).not.toBeNull();
  });

  it("jest dokładnie jeden wiersz ustawień (nie da się dodać drugiego)", async () => {
    expect((await db.sql(`insert into ride_cost_settings(id) values (false)`)).error).not.toBeNull();
    expect((await db.sql(`select count(*) c from ride_cost_settings`)).rows[0].c).toBe(1);
  });

  it("domyślnie automat ceny jest włączony", async () => {
    expect((await db.sql(`select fuel_price_auto from ride_cost_settings`)).rows[0].fuel_price_auto).toBe(true);
  });
});
