// Migracja 0050: limity długości pól (F23) i retencja danych (F21).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { openDb, isDenied } from "../helpers/db.mjs";

let db;
beforeAll(async () => {
  db = await openDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

const count = async (sql) => (await db.sql(`select count(*)::int n from ${sql}`)).rows[0].n;

describe("limity długości pól tekstowych", () => {
  async function chat() {
    const a = await db.user({ name: "A" });
    const b = await db.user({ name: "B" });
    const conv = (await db.sql(`insert into conversations(kind) values ('direct') returning id`)).rows[0].id;
    await db.exec(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${a}'), ('${conv}', '${b}')`);
    return { a, b, conv };
  }
  const send = (who, conv, body) =>
    db.as(who).try(`insert into messages(conversation_id, sender_account_id, body) values ('${conv}', '${who}', '${body}')`);

  it("wiadomość do 2000 znaków przechodzi, dłuższa lub pusta jest odrzucona", async () => {
    const { a, conv } = await chat();
    expect((await send(a, conv, "x".repeat(2000))).error).toBeNull();
    expect((await send(a, conv, "x".repeat(2001))).error).not.toBeNull();
    expect((await send(a, conv, "")).error).not.toBeNull();
  });

  it("powód zgłoszenia nadużycia ma limit 2000 znaków", async () => {
    const a = await db.user();
    const b = await db.user();
    const ins = (reason) => db.as(a).try(`insert into reports(reporter_account_id, reported_account_id, reason) values ('${a}', '${b}', '${reason}')`);
    expect((await ins("spam")).error).toBeNull();
    expect((await ins("x".repeat(2001))).error).not.toBeNull();
  });

  it("pola konta mają rozsądne limity (imię 120, telefon 30), a zwykła edycja działa", async () => {
    const a = await db.user();
    expect((await db.as(a).try(`update accounts set full_name = '${"x".repeat(121)}' where id = '${a}'`)).error).not.toBeNull();
    expect((await db.as(a).try(`update accounts set phone = '${"1".repeat(31)}' where id = '${a}'`)).error).not.toBeNull();
    expect((await db.as(a).try(`update accounts set full_name = 'Jan Kowalski', phone = '600100200', city = 'Zabrze' where id = '${a}'`)).error).toBeNull();
  });

  it("pola zawodnika, notatki wyjazdu i oferty mają limity", async () => {
    const t = await db.tournament();
    const f = await db.family(t, {});
    expect((await db.as(f.account).try(`update players set last_name = '${"n".repeat(81)}' where id = '${f.player}'`)).error).not.toBeNull();
    expect((await db.as(f.account).try(`update trips set notes = '${"n".repeat(501)}' where id = '${f.trip}'`)).error).not.toBeNull();
    const offer = (extra) =>
      db.as(f.account).try(`insert into ride_offers(trip_id, free_seats, driver_notes) values ('${f.trip}', 2, '${extra}')`);
    expect((await offer("x".repeat(1001))).error).not.toBeNull();
    expect((await offer("zabieram bagaż")).error).toBeNull();
  });

  it("ograniczenia są NOT VALID: istniejące, dłuższe dane nie blokują zwykłych operacji", async () => {
    const rows = (await db.sql(`select conname, convalidated from pg_constraint where conname in ('messages_body_length','reports_reason_length','accounts_text_length','players_text_length')`)).rows;
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.convalidated, r.conname).toBe(false);
  });
});

describe("purge_old_data() (retencja)", () => {
  it("jest dostępna tylko dla service_role", async () => {
    const a = await db.user();
    expect((await db.anon().try(`select purge_old_data()`)).error).not.toBeNull();
    expect((await db.as(a).try(`select purge_old_data()`)).error).not.toBeNull();
    expect((await db.service().try(`select purge_old_data()`)).error).toBeNull();
  });

  it("usuwa stare wiadomości, zostawia świeże", async () => {
    const a = await db.user();
    const b = await db.user();
    const conv = (await db.sql(`insert into conversations(kind) values ('direct') returning id`)).rows[0].id;
    await db.exec(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${a}'), ('${conv}', '${b}')`);
    await db.exec(`insert into messages(conversation_id, sender_account_id, body, created_at) values
      ('${conv}', '${a}', 'stara', now() - interval '13 months'), ('${conv}', '${a}', 'świeża', now() - interval '1 month')`);
    const r = (await db.service().one(`select purge_old_data() as r`)).r;
    expect(r.messages).toBe(1);
    expect((await db.sql(`select body from messages`)).rows.map((x) => x.body)).toEqual(["świeża"]);
  });

  it("usuwa prośby po starym turnieju, ale nie po turnieju bieżącym", async () => {
    const old = await db.tournament({ city: "Stary", starts: "2020-05-01", ends: "2020-05-03" });
    const cur = await db.tournament({ city: "Bieżący" });
    for (const t of [old, cur]) {
      const d = await db.family(t, {});
      const g = await db.family(t, {});
      const offer = await db.rideOffer(d.trip, d.account);
      await db.joinRequest(offer, g.trip, "accepted");
    }
    const r = (await db.service().one(`select purge_old_data() as r`)).r;
    expect(r.ride_join_requests).toBe(1);
    expect(await count(`ride_join_requests`)).toBe(1);
  });

  it("czyści próby rejestracji starsze niż 2 dni i rozwiązane zgłoszenia błędów starsze niż pół roku", async () => {
    await db.exec(`insert into signup_attempts(created_at) values (now() - interval '3 days'), (now())`);
    await db.exec(`insert into bug_reports(description, resolved, created_at) values
      ('stare rozwiązane', true, now() - interval '7 months'), ('stare nierozwiązane', false, now() - interval '7 months'), ('świeże rozwiązane', true, now())`);
    const r = (await db.service().one(`select purge_old_data() as r`)).r;
    expect(r.signup_attempts).toBe(1);
    expect(r.bug_reports).toBe(1);
    expect((await db.sql(`select description from bug_reports order by 1`)).rows.map((x) => x.description)).toEqual(["stare nierozwiązane", "świeże rozwiązane"]);
  });

  it("uruchomiona drugi raz nic już nie usuwa (idempotentna)", async () => {
    await db.service().one(`select purge_old_data() as r`);
    const r = (await db.service().one(`select purge_old_data() as r`)).r;
    for (const v of Object.values(r)) expect(v).toBe(0);
  });
});
