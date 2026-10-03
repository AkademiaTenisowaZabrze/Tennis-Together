// Migracja 0047: karty publiczne zamiast pełnych wierszy zawodników i kont (dawniej F6 i F8).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { openDb, isDenied } from "../helpers/db.mjs";

let db;
beforeAll(async () => {
  db = await openDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

describe("karty zawodników (player_cards)", () => {
  async function world() {
    const t = await db.tournament({ city: "Warszawa" });
    const driver = await db.family(t, { name: "Kierowca", club: "ATZ", first: "Dawid" });
    const quiet = await db.family(t, { name: "Cichy", club: "ATZ", first: "Cyprian" });
    const stranger = await db.user({ name: "Obcy" });
    await db.rideOffer(driver.trip, driver.account);
    await db.exec(`update players set last_name = 'Tajny', birth_year = 2013, city = 'Zabrze', pzt_login = 'ABC1234567' where id = '${driver.player}'`);
    return { t, driver, quiet, stranger };
  }

  it("obcy widzi kartę (imię, kategorię, klub) zawodnika, którego wyjazd ma ofertę", async () => {
    const { driver, stranger } = await world();
    const rows = await db.as(stranger).q(`select first_name, club_name from player_cards where player_id = '${driver.player}'`);
    expect(rows).toEqual([{ first_name: "Dawid", club_name: "ATZ" }]);
  });

  it("obcy nie widzi karty zawodnika bez oferty", async () => {
    const { quiet, stranger } = await world();
    expect(await db.as(stranger).q(`select * from player_cards where player_id = '${quiet.player}'`)).toEqual([]);
  });

  it("obcy nie czyta pełnego wiersza zawodnika (nazwisko, rocznik, miasto, login PZT) nawet przy ofercie", async () => {
    const { driver, stranger } = await world();
    expect(await db.as(stranger).q(`select * from players where id = '${driver.player}'`)).toEqual([]);
    expect(await db.as(stranger).q(`select last_name, birth_year, city, pzt_login from players`)).toEqual([]);
  });

  it("karta nie zawiera żadnych danych wrażliwych (tylko imię, kategoria, klub)", async () => {
    const cols = (await db.sql(`select column_name from information_schema.columns where table_name = 'player_cards' order by 1`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(["category", "club_name", "first_name", "player_id"]);
  });

  it("właściciel nadal widzi i edytuje pełny wiersz, a karta podąża za zmianą imienia", async () => {
    const { driver } = await world();
    const own = await db.as(driver.account).q(`select last_name, pzt_login from players where id = '${driver.player}'`);
    expect(own[0]).toMatchObject({ last_name: "Tajny", pzt_login: "ABC1234567" });
    await db.as(driver.account).try(`update players set first_name = 'Dawidek', category = 'U14' where id = '${driver.player}'`);
    expect((await db.sql(`select first_name, category from player_cards where player_id = '${driver.player}'`)).rows[0]).toEqual({ first_name: "Dawidek", category: "U14" });
  });

  it("trener klubu nadal widzi pełne dane zawodników swojego klubu, a trener obcego klubu nie", async () => {
    const { driver } = await world();
    const coach = await db.user({ role: "coach", club: "ATZ" });
    const other = await db.user({ role: "coach", club: "Inny klub" });
    expect((await db.as(coach).q(`select last_name from players where id = '${driver.player}'`))[0]?.last_name).toBe("Tajny");
    expect(await db.as(other).q(`select last_name from players where id = '${driver.player}'`)).toEqual([]);
  });

  it("właściciel oferty widzi kartę zawodnika, który o miejsce poprosił, ale nie jego pełne dane", async () => {
    const t = await db.tournament();
    const d = await db.family(t, { first: "Kierowca" });
    const g = await db.family(t, { first: "Pasażer" });
    const offer = await db.rideOffer(d.trip, d.account);
    await db.joinRequest(offer, g.trip, "pending");
    await db.exec(`update players set last_name = 'Sekret' where id = '${g.player}'`);
    expect((await db.as(d.account).q(`select first_name from player_cards where player_id = '${g.player}'`))[0]?.first_name).toBe("Pasażer");
    expect(await db.as(d.account).q(`select last_name from players where id = '${g.player}'`)).toEqual([]);
  });

  it("anonim nie widzi kart ani zawodników, a karty nie da się zmieniać z zewnątrz", async () => {
    const { driver, stranger } = await world();
    expect(await db.anon().q(`select * from player_cards`)).toEqual([]);
    expect(isDenied(await db.as(stranger).try(`update player_cards set first_name = 'X' where player_id = '${driver.player}' returning player_id`))).toBe(true);
    expect((await db.as(driver.account).try(`insert into player_cards(player_id, first_name) values ('${driver.player}', 'Podmiana')`)).error).not.toBeNull();
  });

  it("zawieszone konto nie czyta kart", async () => {
    const { driver, stranger } = await world();
    await db.exec(`update accounts set status = 'suspended' where id = '${stranger}'`);
    expect(await db.as(stranger).q(`select * from player_cards where player_id = '${driver.player}'`)).toEqual([]);
  });

  it("usunięcie zawodnika usuwa jego kartę i wyjazdy", async () => {
    const { driver } = await world();
    await db.as(driver.account).try(`delete from players where id = '${driver.player}'`);
    expect((await db.sql(`select count(*)::int n from player_cards where player_id = '${driver.player}'`)).rows[0].n).toBe(0);
    expect((await db.sql(`select count(*)::int n from trips where id = '${driver.trip}'`)).rows[0].n).toBe(0);
  });
});

describe("karty kont (account_cards) i telefon rozmówcy", () => {
  async function chat() {
    const a = await db.user({ name: "Anna Rozmówczyni" });
    const b = await db.user({ name: "Bartek Rozmówca" });
    const stranger = await db.user({ name: "Obcy" });
    await db.exec(`update accounts set phone = '600700800' where id = '${a}'`);
    const conv = (await db.sql(`insert into conversations(kind) values ('direct') returning id`)).rows[0].id;
    await db.exec(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${a}'), ('${conv}', '${b}')`);
    return { a, b, stranger };
  }

  it("rozmówca widzi imię i nazwisko drugiej osoby, ale nie jej telefon ani wiersza konta", async () => {
    const { a, b } = await chat();
    expect((await db.as(b).q(`select full_name from account_cards where account_id = '${a}'`))[0]?.full_name).toBe("Anna Rozmówczyni");
    expect(await db.as(b).q(`select phone from accounts where id = '${a}'`)).toEqual([]);
  });

  it("osoba spoza rozmowy nie widzi ani karty, ani konta", async () => {
    const { a, stranger } = await chat();
    expect(await db.as(stranger).q(`select * from account_cards where account_id = '${a}'`)).toEqual([]);
    expect(await db.as(stranger).q(`select * from accounts where id = '${a}'`)).toEqual([]);
  });

  it("karta konta zawiera wyłącznie imię i nazwisko", async () => {
    const cols = (await db.sql(`select column_name from information_schema.columns where table_name = 'account_cards' order by 1`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(["account_id", "full_name"]);
  });

  it("karta podąża za zmianą nazwy konta i znika razem z kontem", async () => {
    const { a } = await chat();
    await db.as(a).try(`update accounts set full_name = 'Anna Nowa' where id = '${a}'`);
    expect((await db.sql(`select full_name from account_cards where account_id = '${a}'`)).rows[0].full_name).toBe("Anna Nowa");
    await db.exec(`delete from accounts where id = '${a}'`);
    expect((await db.sql(`select count(*)::int n from account_cards where account_id = '${a}'`)).rows[0].n).toBe(0);
  });

  it("administrator widzi karty wszystkich kont, anonim żadnej", async () => {
    const { a } = await chat();
    const admin = await db.user({ admin: true });
    expect((await db.as(admin).q(`select * from account_cards where account_id = '${a}'`)).length).toBe(1);
    expect(await db.anon().q(`select * from account_cards`)).toEqual([]);
  });

  it("nowe konto od razu dostaje kartę", async () => {
    const id = crypto.randomUUID();
    await db.exec(`insert into auth.users(id, email) values ('${id}', 'nowa@test.local')`);
    await db.as(id).try(`insert into accounts(id, role, full_name) values ('${id}', 'parent', 'Nowa Osoba')`);
    expect((await db.sql(`select full_name from account_cards where account_id = '${id}'`)).rows[0]?.full_name).toBe("Nowa Osoba");
  });
});
