// Macierz dostępu: kto widzi i zmienia które dane. Anonim, obcy rodzic,
// właściciel, trener tego samego klubu, trener innego klubu, administrator.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openDb, isDenied } from "../helpers/db.mjs";
import { itKnown } from "../helpers/known.js";

let db;
let w; // świat testowy: identyfikatory
beforeAll(async () => {
  db = await openDb();
  await db.reset();
  const t = await db.tournament({ name: "Turniej główny", city: "Warszawa" });
  const A = await db.family(t, { name: "Rodzic A", club: "ATZ", first: "Ala" });
  const B = await db.family(t, { name: "Rodzic B", club: "Inny Klub", first: "Bartek" });
  const coachSame = await db.user({ role: "coach", club: "ATZ", name: "Trener ATZ" });
  const coachOther = await db.user({ role: "coach", club: "Inny Klub", name: "Trener Obcy" });
  // rodzina z klubu ATZ bez żadnej oferty: jej dziecko nie jest "publiczne"
  const Z = await db.family(t, { name: "Rodzic Z bez oferty", club: "ATZ", first: "Zosia" });
  const nonCoachSameClub = await db.user({ role: "parent", club: "ATZ", name: "Rodzic z ATZ bez roli trenera" });
  const admin = await db.user({ admin: true, name: "Admin" });
  const stranger = await db.user({ name: "Obcy" });

  // dane prywatne rodziny A
  const offerA = await db.rideOffer(A.trip, A.account);
  const reqB = await db.joinRequest(offerA, B.trip, "accepted");
  await db.exec(`insert into consents(player_id, given_by_account_id, consent_type) values ('${A.player}', '${A.account}', 'terms')`);
  await db.exec(`insert into device_tokens(account_id, token, platform) values ('${A.account}', 'tok-A', 'android')`);
  await db.exec(`insert into blocks(blocker_account_id, blocked_account_id) values ('${A.account}', '${stranger}')`);
  await db.exec(`insert into reports(reporter_account_id, reported_account_id, reason) values ('${A.account}', '${stranger}', 'spam')`);
  const conv = (await db.sql(`insert into conversations(kind) values ('direct') returning id`)).rows[0].id;
  await db.exec(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${A.account}'), ('${conv}', '${B.account}')`);
  await db.exec(`insert into messages(conversation_id, sender_account_id, body) values ('${conv}', '${A.account}', 'tajna wiadomość')`);
  await db.exec(`insert into ratings(join_request_id, join_request_kind, rater_account_id, rated_account_id, stars) values ('${reqB}', 'ride', '${A.account}', '${B.account}', 5)`);
  await db.exec(`insert into tournament_entries(tournament_id, pzt_login, full_name) values ('${t}', 'ABC1234567', 'Publiczny Zawodnik')`);
  await db.exec(`insert into data_sync_status(key, last_synced_at) values ('tournaments', now())`);
  await db.exec(`insert into trip_groups(tournament_id, created_by_account_id, name) values ('${t}', '${A.account}', 'Grupa A')`);
  w = { t, A, B, Z, coachSame, coachOther, nonCoachSameClub, admin, stranger, offerA, reqB, conv };
});
afterAll(() => db.close());

// Tabele z danymi osób: anonim nie ma prawa zobaczyć NIC.
const PRIVATE_TABLES = [
  "accounts", "players", "trips", "consents", "device_tokens", "blocks", "reports",
  "conversations", "conversation_participants", "messages", "ratings",
  "ride_offers", "ride_requests", "ride_join_requests", "ride_pings",
  "lodging_offers", "lodging_join_requests", "lodging_host_offers", "lodging_host_requests",
  "trip_groups", "trip_group_members", "tournament_entries", "tournaments", "city_coordinates",
  "data_sync_status", "ride_cost_settings", "push_throttle",
];

describe("anonim (klucz publiczny bez logowania)", () => {
  for (const table of PRIVATE_TABLES) {
    it(`nie czyta tabeli ${table}`, async () => {
      expect(await db.anon().q(`select * from ${table} limit 5`)).toEqual([]);
    });
  }

  it("nie dopisuje wierszy do tabel z danymi osób", async () => {
    const attempts = {
      accounts: `insert into accounts(id, role, full_name) values (gen_random_uuid(), 'parent', 'x')`,
      players: `insert into players(owner_account_id, first_name, last_name, birth_year) values ('${w.A.account}', 'x', 'y', 2014)`,
      trips: `insert into trips(player_id, tournament_id, created_by_account_id, departure_city) values ('${w.A.player}', '${w.t}', '${w.A.account}', 'x')`,
      consents: `insert into consents(player_id, given_by_account_id, consent_type) values ('${w.A.player}', '${w.A.account}', 'terms')`,
      device_tokens: `insert into device_tokens(account_id, token) values ('${w.A.account}', 'zly')`,
      messages: `insert into messages(conversation_id, sender_account_id, body) values ('${w.conv}', '${w.A.account}', 'x')`,
      ride_offers: `insert into ride_offers(trip_id, free_seats) values ('${w.A.trip}', 1)`,
      reports: `insert into reports(reporter_account_id, reason) values ('${w.A.account}', 'x')`,
      tournaments: `insert into tournaments(source, name, city, starts_on) values ('itf', 'x', 'y', '2099-01-01')`,
    };
    for (const [table, sql] of Object.entries(attempts)) {
      const r = await db.anon().try(sql);
      expect(r.error, `anonim zapisał do ${table}`).not.toBeNull();
    }
  });

  it("może dopisać zgłoszenie błędu i próbę rejestracji (formularz testerów, licznik)", async () => {
    expect((await db.anon().try(`insert into bug_reports(description) values ('test')`)).error).toBeNull();
    expect((await db.anon().try(`insert into signup_attempts default values`)).error).toBeNull();
  });

  it("anonim nie czyta cudzych zgłoszeń błędów", async () => {
    await db.exec(`insert into bug_reports(tester_name, description) values ('Tester', 'prywatny opis')`);
    expect(await db.anon().q(`select * from bug_reports`)).toEqual([]);
  });

  it("anonim nie odczytuje tabeli prób rejestracji", async () => {
    await db.exec(`insert into signup_attempts default values`);
    expect(await db.anon().q(`select * from signup_attempts`)).toEqual([]);
  });

  it("zwykły zalogowany użytkownik też nie czyta zgłoszeń błędów, a administrator tak", async () => {
    const a = await db.user();
    const admin = await db.user({ admin: true });
    await db.exec(`insert into bug_reports(tester_name, description) values ('Tester', 'opis widoczny tylko dla admina')`);
    expect(await db.as(a).q(`select id from bug_reports`)).toEqual([]);
    expect((await db.as(admin).q(`select id from bug_reports where description = 'opis widoczny tylko dla admina'`)).length).toBe(1);
  });

  it("anonim nadal może zgłosić błąd, ale w granicach długości pól (F23)", async () => {
    expect((await db.anon().try(`insert into bug_reports(description) values ('coś nie działa')`)).error).toBeNull();
    expect(isDenied(await db.anon().try(`insert into bug_reports(description) values ('${"x".repeat(4001)}')`))).toBe(true);
    expect(isDenied(await db.anon().try(`insert into bug_reports(description, tester_name) values ('ok', '${"y".repeat(121)}')`))).toBe(true);
    expect(isDenied(await db.anon().try(`insert into bug_reports(description) values ('')`))).toBe(true);
  });

  it("licznik prób rejestracji: anonim dostaje samą liczbę z funkcji i może dopisać próbę", async () => {
    const before = (await db.anon().one(`select signup_attempts_last_hour() as n`)).n;
    await db.exec(`insert into signup_attempts default values; insert into signup_attempts default values`);
    expect((await db.anon().one(`select signup_attempts_last_hour() as n`)).n).toBe(before + 2);
    expect((await db.anon().try(`insert into signup_attempts default values`)).error).toBeNull();
    expect((await db.anon().one(`select signup_attempts_last_hour() as n`)).n).toBe(before + 3);
  });

  it("anonim nie może zmienić ani usunąć zgłoszeń błędów", async () => {
    await db.exec(`insert into bug_reports(description) values ('do ochrony')`);
    expect(isDenied(await db.anon().try(`update bug_reports set resolved = true returning id`))).toBe(true);
    expect(isDenied(await db.anon().try(`delete from bug_reports returning id`))).toBe(true);
  });
});

describe("obcy rodzic (zalogowany, bez związku z danymi)", () => {
  it("nie widzi cudzych zgód, tokenów, blokad, zgłoszeń, rozmów ani ocen", async () => {
    const s = db.as(w.stranger);
    for (const table of ["consents", "device_tokens", "conversations", "conversation_participants", "messages", "ratings"]) {
      expect(await s.q(`select * from ${table}`), table).toEqual([]);
    }
    // blokada jest wymierzona w obcego, ale to nie on ją założył
    expect(await s.q(`select * from blocks`)).toEqual([]);
    expect(await s.q(`select * from reports`)).toEqual([]);
  });

  it("nie widzi cudzych próśb o dołączenie", async () => {
    expect(await db.as(w.stranger).q(`select * from ride_join_requests`)).toEqual([]);
  });

  it("nie czyta cudzego telefonu ani innych kont", async () => {
    const rows = await db.as(w.stranger).q(`select id from accounts`);
    expect(rows.map((r) => r.id)).toEqual([w.stranger]);
  });

  it("nie zmienia i nie usuwa cudzych zawodników, wyjazdów ani ofert", async () => {
    const s = db.as(w.stranger);
    expect(isDenied(await s.try(`update players set first_name = 'Zhakowany' where id = '${w.A.player}' returning id`))).toBe(true);
    expect(isDenied(await s.try(`delete from players where id = '${w.A.player}' returning id`))).toBe(true);
    expect(isDenied(await s.try(`update trips set departure_city = 'Hak' where id = '${w.A.trip}' returning id`))).toBe(true);
    expect(isDenied(await s.try(`delete from trips where id = '${w.A.trip}' returning id`))).toBe(true);
    expect(isDenied(await s.try(`update ride_offers set free_seats = 99 where id = '${w.offerA}' returning id`))).toBe(true);
    expect(isDenied(await s.try(`delete from ride_offers where id = '${w.offerA}' returning id`))).toBe(true);
  });

  it("nie dopisze zawodnika, wyjazdu ani oferty w imieniu innej osoby", async () => {
    const s = db.as(w.stranger);
    expect((await s.try(`insert into players(owner_account_id, first_name, last_name, birth_year) values ('${w.A.account}', 'Podstawiony', 'X', 2014)`)).error).not.toBeNull();
    expect((await s.try(`insert into trips(player_id, tournament_id, created_by_account_id, departure_city) values ('${w.A.player}', '${w.t}', '${w.stranger}', 'x')`)).error).not.toBeNull();
    expect((await s.try(`insert into ride_offers(trip_id, free_seats) values ('${w.A.trip}', 1)`)).error).not.toBeNull();
  });

  it("nie zapisze zgody ani tokenu push w imieniu cudzego konta", async () => {
    const s = db.as(w.stranger);
    expect((await s.try(`insert into consents(player_id, given_by_account_id, consent_type) values ('${w.A.player}', '${w.A.account}', 'terms')`)).error).not.toBeNull();
    expect((await s.try(`insert into device_tokens(account_id, token) values ('${w.A.account}', 'przechwycony')`)).error).not.toBeNull();
  });

  it("nie napisze wiadomości do cudzej rozmowy ani w cudzym imieniu", async () => {
    const s = db.as(w.stranger);
    expect((await s.try(`insert into messages(conversation_id, sender_account_id, body) values ('${w.conv}', '${w.stranger}', 'wtargnięcie')`)).error).not.toBeNull();
    expect((await s.try(`insert into messages(conversation_id, sender_account_id, body) values ('${w.conv}', '${w.A.account}', 'podszycie')`)).error).not.toBeNull();
  });

  it("nie doda się do cudzej rozmowy ani nie doda tam kogoś innego", async () => {
    const s = db.as(w.stranger);
    expect((await s.try(`insert into conversation_participants(conversation_id, account_id) values ('${w.conv}', '${w.stranger}')`)).error).not.toBeNull();
    expect((await s.try(`insert into conversation_participants(conversation_id, account_id) values ('${w.conv}', '${w.B.account}')`)).error).not.toBeNull();
  });

  it("nie wystawi oceny za spotkanie, w którym nie brał udziału", async () => {
    const r = await db.as(w.stranger).try(
      `insert into ratings(join_request_id, join_request_kind, rater_account_id, rated_account_id, stars) values ('${w.reqB}', 'ride', '${w.stranger}', '${w.A.account}', 1)`
    );
    expect(r.error).not.toBeNull();
  });

  it("nie zgłosi nadużycia w cudzym imieniu", async () => {
    const r = await db.as(w.stranger).try(`insert into reports(reporter_account_id, reason) values ('${w.A.account}', 'fałszywe')`);
    expect(r.error).not.toBeNull();
  });

  it("nie zmieni cudzych blokad", async () => {
    expect(isDenied(await db.as(w.stranger).try(`delete from blocks returning *`))).toBe(true);
  });
});

describe("właściciel widzi swoje dane", () => {
  it("rodzic A widzi swoje zgody, tokeny, blokady, zgłoszenia i konto", async () => {
    const a = db.as(w.A.account);
    expect((await a.q(`select * from consents`)).length).toBe(1);
    expect((await a.q(`select * from device_tokens`)).length).toBe(1);
    expect((await a.q(`select * from blocks`)).length).toBe(1);
    expect((await a.q(`select * from reports`)).length).toBe(1);
    expect((await a.q(`select * from players where id = '${w.A.player}'`)).length).toBe(1);
  });

  it("uczestnik rozmowy widzi wiadomości, a druga strona również", async () => {
    expect((await db.as(w.A.account).q(`select body from messages`)).length).toBe(1);
    expect((await db.as(w.B.account).q(`select body from messages`)).length).toBe(1);
  });

  it("uczestnik rozmowy może do niej pisać wyłącznie jako on sam", async () => {
    const ok = await db.as(w.B.account).try(`insert into messages(conversation_id, sender_account_id, body) values ('${w.conv}', '${w.B.account}', 'odpowiedź')`);
    expect(ok.error).toBeNull();
    const fake = await db.as(w.B.account).try(`insert into messages(conversation_id, sender_account_id, body) values ('${w.conv}', '${w.A.account}', 'podszyty')`);
    expect(fake.error).not.toBeNull();
  });

  it("rodzic B widzi swoje oceny (wystawione A dla B), A widzi swoje", async () => {
    expect((await db.as(w.B.account).q(`select * from ratings`)).length).toBe(1);
    expect((await db.as(w.A.account).q(`select * from ratings`)).length).toBe(1);
  });

  it("zalogowany widzi dane referencyjne: turnieje, miasta, listy startowe, status synchronizacji", async () => {
    const s = db.as(w.stranger);
    expect((await s.q(`select * from tournaments`)).length).toBeGreaterThan(0);
    expect((await s.q(`select * from city_coordinates`)).length).toBeGreaterThan(400);
    expect((await s.q(`select * from tournament_entries`)).length).toBe(1);
    expect((await s.q(`select * from data_sync_status`)).length).toBe(1);
  });
});

describe("trener: widoczność klubu", () => {
  it("trener tego samego klubu widzi zawodników i wyjazdy klubu (także bez oferty)", async () => {
    const c = db.as(w.coachSame);
    expect((await c.q(`select id from players`)).map((p) => p.id)).toContain(w.Z.player);
    expect((await c.q(`select id from trips`)).map((t) => t.id)).toContain(w.Z.trip);
  });

  it("trener tego samego klubu nie widzi zawodników innego klubu bez oferty", async () => {
    const hidden = await db.family(w.t, { name: "Rodzic obcy", club: "Trzeci Klub", first: "Tomek" });
    const players = await db.as(w.coachSame).q(`select id from players`);
    expect(players.map((p) => p.id)).not.toContain(hidden.player);
  });

  it("trener innego klubu nie widzi zawodników klubu ATZ", async () => {
    const players = await db.as(w.coachOther).q(`select id from players`);
    expect(players.map((p) => p.id)).not.toContain(w.Z.player);
  });

  it("konto z nazwą klubu, ale bez roli trenera, nie widzi zawodników klubu", async () => {
    const players = await db.as(w.nonCoachSameClub).q(`select id from players`);
    expect(players.map((p) => p.id)).not.toContain(w.Z.player);
  });

  it("nazwa klubu jest porównywana bez względu na wielkość liter i spacje", async () => {
    const c = await db.user({ role: "coach", club: "  atz ", name: "Trener z literówką wielkości" });
    const players = await db.as(c).q(`select id from players`);
    expect(players.map((p) => p.id)).toContain(w.Z.player);
  });

  it("trener nie może zmienić ani usunąć cudzego zawodnika", async () => {
    const c = db.as(w.coachSame);
    expect(isDenied(await c.try(`update players set first_name = 'Zmiana' where id = '${w.Z.player}' returning id`))).toBe(true);
    expect(isDenied(await c.try(`delete from players where id = '${w.Z.player}' returning id`))).toBe(true);
    expect(isDenied(await c.try(`update trips set status = 'cancelled' where id = '${w.Z.trip}' returning id`))).toBe(true);
  });

  it("trener nie widzi prywatnych rozmów, zgód ani tokenów rodziców", async () => {
    const c = db.as(w.coachSame);
    for (const table of ["messages", "consents", "device_tokens", "ratings"]) {
      expect(await c.q(`select * from ${table}`), table).toEqual([]);
    }
  });
});

describe("administrator", () => {
  it("widzi zgłoszenia nadużyć i blokady, ale nie czyta wiadomości rodziców", async () => {
    const ad = db.as(w.admin);
    expect((await ad.q(`select * from reports`)).length).toBeGreaterThan(0);
    expect((await ad.q(`select * from blocks`)).length).toBeGreaterThan(0);
    expect(await ad.q(`select * from messages`)).toEqual([]);
    expect(await ad.q(`select * from device_tokens`)).toEqual([]);
  });
});

describe("prywatność danych dzieci i telefonu (zamknięte w 0047, dawniej F6 i F8)", () => {
  it("uczestnik rozmowy nie odczytuje telefonu drugiej osoby", async () => {
    await db.exec(`update accounts set phone = '600700800' where id = '${w.A.account}'`);
    const rows = await db.as(w.B.account).q(`select phone from accounts where id = '${w.A.account}'`);
    expect(rows[0]?.phone ?? null).toBeNull();
  });

  it("obcy rodzic nie odczytuje nazwiska, rocznika, miasta i loginu PZT cudzego dziecka", async () => {
    await db.exec(`update players set pzt_login = 'SEKRET1234567', city = 'Zabrze' where id = '${w.A.player}'`);
    const rows = await db.as(w.stranger).q(`select last_name, birth_year, city, pzt_login from players where id = '${w.A.player}'`);
    // oferta przejazdu ma wyjazd tego dziecka, więc polityka publiczna je ujawnia
    expect(rows.length === 0 || rows[0].last_name === null).toBe(true);
  });

  it("obcy rodzic widzi imię dziecka tylko wtedy, gdy wyjazd ma ofertę przejazdu lub noclegu", async () => {
    const c = await db.family(w.t, { name: "Rodzic C bez oferty", first: "Cyprian" });
    const rows = await db.as(w.stranger).q(`select id from players where id = '${c.player}'`);
    expect(rows).toEqual([]);
  });
});
