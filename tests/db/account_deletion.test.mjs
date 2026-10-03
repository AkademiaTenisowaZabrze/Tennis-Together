// Migracja 0048: usuwanie konta i danych (RODO art. 17), dawniej luka F3.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { openDb } from "../helpers/db.mjs";

let db;
beforeAll(async () => {
  db = await openDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

const count = async (sql) => (await db.sql(`select count(*)::int n from ${sql}`)).rows[0].n;

describe("delete_my_account()", () => {
  it("anonim nie może usunąć żadnego konta", async () => {
    const a = await db.user();
    const r = await db.anon().try(`select delete_my_account()`);
    expect(r.error).not.toBeNull();
    expect(await count(`accounts where id = '${a}'`)).toBe(1);
  });

  it("funkcja nie jest wykonywalna dla anonima, tylko dla zalogowanych", async () => {
    const r = (await db.sql(`select has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u
      from pg_proc p where p.proname = 'delete_my_account'`)).rows[0];
    expect(r).toEqual({ a: false, u: true });
  });

  it("zalogowany usuwa własne konto razem ze wszystkimi swoimi danymi", async () => {
    const t = await db.tournament();
    const a = await db.family(t, { name: "Do usunięcia" });
    const b = await db.family(t, { name: "Zostaje" });
    const offer = await db.rideOffer(a.trip, a.account);
    await db.exec(`insert into device_tokens(account_id, token) values ('${a.account}', 'tok')`);
    await db.exec(`insert into consents(player_id, given_by_account_id, consent_type) values ('${a.player}', '${a.account}', 'terms')`);
    await db.exec(`insert into reports(reporter_account_id, reported_account_id, reason) values ('${a.account}', '${b.account}', 'x'), ('${b.account}', '${a.account}', 'y')`);
    const conv = (await db.sql(`insert into conversations(kind) values ('direct') returning id`)).rows[0].id;
    await db.exec(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${a.account}'), ('${conv}', '${b.account}')`);
    await db.exec(`insert into messages(conversation_id, sender_account_id, body) values ('${conv}', '${a.account}', 'pa')`);
    await db.joinRequest(offer, b.trip, "pending");

    const r = await db.as(a.account).try(`select delete_my_account()`);
    expect(r.error).toBeNull();

    for (const q of [
      `accounts where id = '${a.account}'`,
      `account_cards where account_id = '${a.account}'`,
      `players where owner_account_id = '${a.account}'`,
      `player_cards where player_id = '${a.player}'`,
      `trips where created_by_account_id = '${a.account}'`,
      `ride_offers where id = '${offer}'`,
      `ride_join_requests`,
      `device_tokens`,
      `consents`,
      `reports`,
      `messages where sender_account_id = '${a.account}'`,
      `conversation_participants where account_id = '${a.account}'`,
    ]) {
      expect(await count(q), q).toBe(0);
    }
    // dane drugiej osoby nietknięte
    expect(await count(`accounts where id = '${b.account}'`)).toBe(1);
    expect(await count(`players where owner_account_id = '${b.account}'`)).toBe(1);
    expect(await count(`trips where created_by_account_id = '${b.account}'`)).toBe(1);
  });

  it("konto ze spotkaniem potwierdzonym kodem i zapisaną oceną da się usunąć; druga strona zachowuje swoje dane", async () => {
    const t = await db.tournament();
    const driver = await db.family(t, { name: "Kierowca" });
    const guest = await db.family(t, { name: "Pasażer" });
    const offer = await db.rideOffer(driver.trip, driver.account);
    const req = await db.joinRequest(offer, guest.trip, "accepted");
    await db.as(driver.account).try(`update ride_join_requests set meeting_code = 'ABC123' where id = '${req}'`);
    expect((await db.as(guest.account).one(`select confirm_meeting('${req}', 'ride', 'ABC123') as r`)).r.result).toBe("ok");
    expect((await db.as(guest.account).try(`insert into ratings(join_request_id, join_request_kind, rater_account_id, rated_account_id, stars) values ('${req}', 'ride', '${guest.account}', '${driver.account}', 5)`)).error).toBeNull();

    expect((await db.as(guest.account).try(`select delete_my_account()`)).error).toBeNull();

    expect(await count(`accounts where id = '${guest.account}'`)).toBe(0);
    expect(await count(`ratings where rater_account_id = '${guest.account}'`)).toBe(0);
    expect(await count(`ride_join_requests where id = '${req}'`)).toBe(0); // ustalenie znika razem z wyjazdem usuwanego
    expect(await count(`accounts where id = '${driver.account}'`)).toBe(1);
    expect(await count(`ride_offers where id = '${offer}'`)).toBe(1);
  });

  it("znaczniki spotkania wskazujące na usuwane konto są zerowane, a nie blokują usunięcia (SET NULL)", async () => {
    const rows = (await db.sql(`select conrelid::regclass::text tbl, a.attname col, confdeltype d
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where contype = 'f' and confrelid = 'public.accounts'::regclass and a.attname like 'meeting\_%'`)).rows;
    expect(rows.length).toBeGreaterThanOrEqual(7);
    for (const r of rows) expect(r.d, `${r.tbl}.${r.col}`).toBe("n");
  });

  it("po usunięciu konta administrator nie traci dostępu do reszty, a usunięty użytkownik nie ma sesji w bazie", async () => {
    const admin = await db.user({ admin: true });
    const a = await db.user();
    await db.as(a).try(`select delete_my_account()`);
    expect((await db.as(admin).q(`select id from accounts`)).map((r) => r.id)).toEqual([admin]);
    expect(await count(`auth.users where id = '${a}'`)).toBe(0);
  });

  it("zawieszone konto też może usunąć swoje dane (prawo do usunięcia nie zależy od statusu)", async () => {
    const a = await db.user({ status: "suspended" });
    expect((await db.as(a).try(`select delete_my_account()`)).error).toBeNull();
    expect(await count(`accounts where id = '${a}'`)).toBe(0);
  });
});
