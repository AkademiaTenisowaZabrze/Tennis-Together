// Powiadomienia push: czy triggery w bazie wysyłają właściwe zdarzenia do Edge
// Function i czy ładunek nie zawiera danych osobowych (tylko identyfikatory).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { openDb } from "../helpers/db.mjs";

let db;
beforeAll(async () => {
  db = await openDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

const ALLOWED_KEYS = new Set(["event", "request_kind", "request_id", "message_id", "trip_id", "source"]);

async function world() {
  const t = await db.tournament({ city: "Warszawa" });
  const driver = await db.family(t, { name: "Anna Kowalska", first: "Dawid" });
  const guest = await db.family(t, { name: "Jan Nowak", first: "Gość" });
  const offer = await db.rideOffer(driver.trip, driver.account);
  await db.clearCalls();
  return { t, driver, guest, offer };
}

describe("zdarzenia push dla przejazdów", () => {
  it("nowa prośba wysyła request_created z rodzajem 'ride' i identyfikatorem", async () => {
    const { guest, offer } = await world();
    const req = await db.joinRequest(offer, guest.trip, "pending");
    const calls = await db.calls("request_created");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ event: "request_created", request_kind: "ride", request_id: req });
  });

  it("akceptacja wysyła request_accepted (raz)", async () => {
    const { guest, offer } = await world();
    const req = await db.joinRequest(offer, guest.trip, "pending");
    await db.clearCalls();
    await db.exec(`update ride_join_requests set status = 'accepted' where id = '${req}'`);
    const calls = await db.calls("request_accepted");
    expect(calls).toHaveLength(1);
    expect(calls[0].request_kind).toBe("ride");
  });

  it("odrzucenie i anulowanie wysyłają request_closed", async () => {
    const { guest, offer } = await world();
    const r1 = await db.joinRequest(offer, guest.trip, "pending");
    await db.clearCalls();
    await db.exec(`update ride_join_requests set status = 'declined' where id = '${r1}'`);
    expect(await db.calls("request_closed")).toHaveLength(1);
    await db.clearCalls();
    const r2 = await db.joinRequest(offer, (await db.family((await db.sql(`select tournament_id from trips where id = '${guest.trip}'`)).rows[0].tournament_id, {})).trip, "accepted");
    await db.clearCalls();
    await db.exec(`update ride_join_requests set status = 'cancelled' where id = '${r2}'`);
    expect(await db.calls("request_closed")).toHaveLength(1);
  });

  it("zmiana innej kolumny niż status nie wysyła powiadomień o statusie", async () => {
    const { guest, offer } = await world();
    const req = await db.joinRequest(offer, guest.trip, "accepted");
    await db.clearCalls();
    await db.exec(`update ride_join_requests set meeting_place = 'dworzec' where id = '${req}'`);
    expect(await db.calls("request_accepted")).toHaveLength(0);
    expect(await db.calls("request_closed")).toHaveLength(0);
  });

  it("ustawienie pineski wysyła meeting_point_set, wyczyszczenie nie wysyła", async () => {
    const { guest, offer } = await world();
    const req = await db.joinRequest(offer, guest.trip, "accepted");
    await db.clearCalls();
    await db.exec(`update ride_join_requests set meeting_lat = 50.3, meeting_lng = 18.7, meeting_point_set_by = '${guest.account}' where id = '${req}'`);
    expect(await db.calls("meeting_point_set")).toHaveLength(1);
    await db.clearCalls();
    await db.exec(`update ride_join_requests set meeting_lat = null, meeting_lng = null where id = '${req}'`);
    expect(await db.calls("meeting_point_set")).toHaveLength(0);
  });

  it("potwierdzenie spotkania wysyła meeting_confirmed", async () => {
    const { driver, guest, offer } = await world();
    const req = await db.joinRequest(offer, guest.trip, "accepted");
    await db.as(driver.account).try(`update ride_join_requests set meeting_code = 'ABC123' where id = '${req}'`);
    await db.clearCalls();
    await db.as(guest.account).try(`select confirm_meeting('${req}', 'ride', 'ABC123')`);
    expect(await db.calls("meeting_confirmed")).toHaveLength(1);
  });

  it("błędny kod nie wysyła meeting_confirmed", async () => {
    const { driver, guest, offer } = await world();
    const req = await db.joinRequest(offer, guest.trip, "accepted");
    await db.as(driver.account).try(`update ride_join_requests set meeting_code = 'ABC123' where id = '${req}'`);
    await db.clearCalls();
    await db.as(guest.account).try(`select confirm_meeting('${req}', 'ride', 'WRONG1')`);
    expect(await db.calls("meeting_confirmed")).toHaveLength(0);
  });
});

describe("zdarzenia push dla pozostałych funkcji", () => {
  it("nowa wiadomość wysyła new_message z identyfikatorem wiadomości (bez treści)", async () => {
    const { driver, guest } = await world();
    const conv = (await db.sql(`insert into conversations(kind) values ('direct') returning id`)).rows[0].id;
    await db.exec(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${driver.account}'), ('${conv}', '${guest.account}')`);
    await db.clearCalls();
    await db.exec(`insert into messages(conversation_id, sender_account_id, body) values ('${conv}', '${driver.account}', 'Tajna treść wiadomości')`);
    const calls = await db.calls("new_message");
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0])).not.toContain("Tajna treść");
  });

  it("nowy wyjazd wysyła club_trip_created", async () => {
    const t = await db.tournament();
    await db.clearCalls();
    const f = await db.family(t, { club: "ATZ" });
    const calls = await db.calls("club_trip_created");
    expect(calls).toHaveLength(1);
    expect(calls[0].trip_id).toBe(f.trip);
  });

  it("zgłoszenie błędu wysyła admin_report ze źródłem 'bug'", async () => {
    await db.clearCalls();
    await db.exec(`insert into bug_reports(description) values ('opis błędu')`);
    const calls = await db.calls("admin_report");
    expect(calls).toHaveLength(1);
    expect(calls[0].source).toBe("bug");
  });

  it("zgłoszenie nadużycia wysyła admin_report ze źródłem 'abuse'", async () => {
    const a = await db.user();
    const b = await db.user();
    await db.clearCalls();
    await db.exec(`insert into reports(reporter_account_id, reported_account_id, reason) values ('${a}', '${b}', 'nękanie')`);
    const calls = await db.calls("admin_report");
    expect(calls).toHaveLength(1);
    expect(calls[0].source).toBe("abuse");
  });
});

describe("prywatność ładunku powiadomień", () => {
  it("żadne zdarzenie nie przenosi imion, treści, telefonów ani współrzędnych", async () => {
    const { driver, guest, offer } = await world();
    await db.exec(`update accounts set phone = '600700800' where id = '${driver.account}'`);
    const req = await db.joinRequest(offer, guest.trip, "pending");
    await db.exec(`update ride_join_requests set status = 'accepted' where id = '${req}'`);
    await db.exec(`update ride_join_requests set meeting_lat = 50.123456, meeting_lng = 18.654321, meeting_place = 'Sekretny parking', meeting_point_set_by = '${guest.account}' where id = '${req}'`);
    await db.exec(`insert into bug_reports(tester_name, description) values ('Tajny Tester', 'Poufny opis')`);
    const all = await db.calls();
    expect(all.length).toBeGreaterThan(3);
    const blob = JSON.stringify(all);
    for (const secret of ["Anna Kowalska", "Jan Nowak", "600700800", "50.123456", "18.654321", "Sekretny parking", "Tajny Tester", "Poufny opis", "Kuba", "Dawid"]) {
      expect(blob, secret).not.toContain(secret);
    }
  });

  it("ładunek zawiera wyłącznie dozwolone klucze (identyfikatory i rodzaj)", async () => {
    const { driver, guest, offer } = await world();
    const req = await db.joinRequest(offer, guest.trip, "pending");
    await db.exec(`update ride_join_requests set status = 'accepted' where id = '${req}'`);
    await db.exec(`insert into bug_reports(description) values ('x')`);
    for (const body of await db.calls()) {
      for (const key of Object.keys(body)) expect(ALLOWED_KEYS.has(key), `nieoczekiwany klucz ${key} w zdarzeniu ${body.event}`).toBe(true);
    }
  });

  it("każde zdarzenie wskazuje adres funkcji notify-tournament", async () => {
    await world();
    await db.exec(`insert into bug_reports(description) values ('x')`);
    const r = await db.sql(`select url from net._calls`);
    for (const row of r.rows) expect(row.url).toMatch(/\/functions\/v1\/notify-tournament$/);
  });
});

describe("funkcje pomocnicze powiadomień nie są dostępne dla użytkowników", () => {
  it("claim_push_slot, claim_coach_digests i claim_trip_reminders: tylko service_role", async () => {
    const u = await db.user();
    for (const sql of [`select claim_push_slot('klucz', 5)`, `select * from claim_coach_digests()`, `select * from claim_trip_reminders(1)`]) {
      expect((await db.as(u).try(sql)).error, sql).not.toBeNull();
      expect((await db.anon().try(sql)).error, sql).not.toBeNull();
      expect((await db.service().try(sql)).error, sql).toBeNull();
    }
  });

  it("claim_push_slot zwraca true tylko raz w oknie czasowym", async () => {
    const s = db.service();
    expect((await s.one(`select claim_push_slot('k1', 10) as ok`)).ok).toBe(true);
    expect((await s.one(`select claim_push_slot('k1', 10) as ok`)).ok).toBe(false);
    expect((await s.one(`select claim_push_slot('k2', 10) as ok`)).ok).toBe(true);
  });

  it("push_throttle jest niewidoczna dla użytkowników", async () => {
    const u = await db.user();
    await db.service().try(`select claim_push_slot('k', 5)`);
    expect(await db.as(u).q(`select * from push_throttle`)).toEqual([]);
  });
});

describe("sekret wywołań funkcji brzegowej (0045, dawniej F5)", () => {
  const headersOfCalls = async () => (await db.sql(`select headers from net._calls order by id`)).rows.map((r) => r.headers);

  it("bez skonfigurowanego sekretu wywołania działają jak dotąd (bez nagłówka x-webhook-secret)", async () => {
    const { guest, offer } = await world();
    await db.joinRequest(offer, guest.trip, "pending");
    const hs = await headersOfCalls();
    expect(hs.length).toBeGreaterThan(0);
    for (const h of hs) {
      expect(h["x-webhook-secret"]).toBeUndefined();
      expect(h.Authorization).toMatch(/^Bearer /);
    }
  });

  it("po ustawieniu sekretu KAŻDE wywołanie z triggerów niesie nagłówek x-webhook-secret", async () => {
    await db.exec(`insert into private_config(key, value) values ('notify_webhook_secret', 'tajny-test-123')`);
    const { driver, guest, offer } = await world();
    const req = await db.joinRequest(offer, guest.trip, "pending");
    await db.exec(`update ride_join_requests set status = 'accepted' where id = '${req}'`);
    const conv = (await db.sql(`insert into conversations(kind) values ('direct') returning id`)).rows[0].id;
    await db.exec(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${driver.account}'), ('${conv}', '${guest.account}')`);
    await db.as(driver.account).try(`insert into messages(conversation_id, sender_account_id, body) values ('${conv}', '${driver.account}', 'cześć')`);
    const hs = await headersOfCalls();
    expect(hs.length).toBeGreaterThanOrEqual(3);
    for (const h of hs) expect(h["x-webhook-secret"]).toBe("tajny-test-123");
  });

  it("sekret nie jest dostępny przez API: tabela private_config i funkcja nagłówków są zamknięte", async () => {
    await db.exec(`insert into private_config(key, value) values ('notify_webhook_secret', 'tajny-test-123')`);
    const a = await db.user();
    for (const who of [db.anon(), db.as(a)]) {
      expect((await who.try(`select * from private_config`)).error).not.toBeNull();
      expect((await who.try(`select notify_edge_headers()`)).error).not.toBeNull();
    }
  });
});
