// Eskalacja uprawnień: czy zwykły użytkownik może sam zmienić to, co zarządza
// dostępem (is_admin, status, verified, role). Test na prawdziwych migracjach.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { openDb, isDenied } from "../helpers/db.mjs";

let db;
beforeAll(async () => {
  db = await openDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

describe("konto: pola bezpieczne", () => {
  it("użytkownik widzi tylko własne konto", async () => {
    const a = await db.user({ name: "A" });
    await db.user({ name: "B" });
    const rows = await db.as(a).q(`select id from accounts`);
    expect(rows.map((r) => r.id)).toEqual([a]);
  });

  it("użytkownik może zmienić swoje imię, miasto i telefon", async () => {
    const a = await db.user();
    const r = await db.as(a).try(`update accounts set full_name = 'Nowe Imię', city = 'Gliwice', phone = '600100200' where id = '${a}' returning full_name`);
    expect(r.error).toBeNull();
    expect(r.rows[0].full_name).toBe("Nowe Imię");
  });

  it("użytkownik nie może zmienić cudzego konta", async () => {
    const a = await db.user();
    const b = await db.user({ name: "Ofiara" });
    const r = await db.as(a).try(`update accounts set full_name = 'Włamanie' where id = '${b}' returning id`);
    expect(isDenied(r)).toBe(true);
    expect((await db.sql(`select full_name from accounts where id = '${b}'`)).rows[0].full_name).toBe("Ofiara");
  });

  it("użytkownik nie może usunąć cudzego konta", async () => {
    const a = await db.user();
    const b = await db.user();
    const r = await db.as(a).try(`delete from accounts where id = '${b}' returning id`);
    expect(isDenied(r)).toBe(true);
  });

  it("anonim nie widzi żadnych kont ani ich nie zmienia", async () => {
    const a = await db.user();
    expect(await db.anon().q(`select id from accounts`)).toEqual([]);
    expect(isDenied(await db.anon().try(`update accounts set full_name = 'x' where id = '${a}' returning id`))).toBe(true);
  });
});

describe("konto: pola uprawnień (naprawione w 0043, dawniej F1 i F2)", () => {
  it("użytkownik nie może nadać sobie is_admin", async () => {
    const a = await db.user();
    const r = await db.as(a).try(`update accounts set is_admin = true where id = '${a}' returning is_admin`);
    expect(isDenied(r) || r.rows[0]?.is_admin !== true).toBe(true);
    const stored = (await db.sql(`select is_admin from accounts where id = '${a}'`)).rows[0].is_admin;
    expect(stored).toBe(false);
  });

  it("po próbie samonadania is_admin() nadal zwraca false", async () => {
    const a = await db.user();
    await db.as(a).try(`update accounts set is_admin = true where id = '${a}'`);
    const r = await db.as(a).one(`select is_admin() as admin`);
    expect(r.admin).toBe(false);
  });

  it("użytkownik nie może sam sobie nadać verified (Parent Verified)", async () => {
    const a = await db.user();
    await db.as(a).try(`update accounts set verified = true where id = '${a}'`);
    const stored = (await db.sql(`select verified from accounts where id = '${a}'`)).rows[0].verified;
    expect(stored).not.toBe(true);
  });

  it("zawieszone konto nie może samo przywrócić status active", async () => {
    const a = await db.user({ status: "suspended" });
    await db.as(a).try(`update accounts set status = 'active' where id = '${a}'`);
    const stored = (await db.sql(`select status from accounts where id = '${a}'`)).rows[0].status;
    expect(stored).toBe("suspended");
  });

  it("nowe konto nie może od razu powstać z is_admin = true", async () => {
    const id = crypto.randomUUID();
    await db.exec(`insert into auth.users(id, email) values ('${id}', 'nowy@test.local')`);
    await db.as(id).try(`insert into accounts(id, role, full_name, is_admin) values ('${id}', 'parent', 'Intruz', true)`);
    const rows = (await db.sql(`select is_admin from accounts where id = '${id}'`)).rows;
    expect(rows[0]?.is_admin ?? false).toBe(false);
  });

  it("nowe konto nie może od razu powstać z verified = true", async () => {
    const id = crypto.randomUUID();
    await db.exec(`insert into auth.users(id, email) values ('${id}', 'nowy2@test.local')`);
    await db.as(id).try(`insert into accounts(id, role, full_name, verified) values ('${id}', 'parent', 'Intruz', true)`);
    const rows = (await db.sql(`select verified from accounts where id = '${id}'`)).rows;
    expect(rows[0]?.verified ?? false).not.toBe(true);
  });

  it("użytkownik nie może sam zostać trenerem (rola coach)", async () => {
    const a = await db.user({ club: "ATZ" });
    await db.as(a).try(`update accounts set role = 'coach' where id = '${a}'`);
    const stored = (await db.sql(`select role from accounts where id = '${a}'`)).rows[0].role;
    expect(stored).not.toBe("coach");
  });

  it("nowe konto nie może od razu zarejestrować się jako coach", async () => {
    const id = crypto.randomUUID();
    await db.exec(`insert into auth.users(id, email) values ('${id}', 'trener@test.local')`);
    await db.as(id).try(`insert into accounts(id, role, full_name, club_name) values ('${id}', 'coach', 'Fałszywy Trener', 'ATZ')`);
    const rows = (await db.sql(`select role from accounts where id = '${id}'`)).rows;
    expect(rows[0]?.role).not.toBe("coach");
  });
});

describe("rola trenera wymaga zatwierdzenia (0043)", () => {
  const roleOf = async (id) => (await db.sql(`select role, coach_requested from accounts where id = '${id}'`)).rows[0];

  it("rejestracja jako trener kończy się rolą rodzica z prośbą o zatwierdzenie", async () => {
    const id = crypto.randomUUID();
    await db.exec(`insert into auth.users(id, email) values ('${id}', 'prosba@test.local')`);
    const r = await db.as(id).try(`insert into accounts(id, role, full_name, club_name) values ('${id}', 'coach', 'Kandydat', 'ATZ') returning role, coach_requested`);
    expect(r.error).toBeNull();
    expect(r.rows[0]).toMatchObject({ role: "parent", coach_requested: true });
  });

  it("zwykła rejestracja nie ustawia prośby o rolę trenera", async () => {
    const id = crypto.randomUUID();
    await db.exec(`insert into auth.users(id, email) values ('${id}', 'zwykly@test.local')`);
    await db.as(id).try(`insert into accounts(id, role, full_name, coach_requested) values ('${id}', 'guardian', 'Opiekun', true)`);
    expect(await roleOf(id)).toMatchObject({ role: "guardian", coach_requested: false });
  });

  it("zmiana roli na coach zapisuje tylko prośbę, a dotychczasowa rola zostaje", async () => {
    const a = await db.user({ club: "ATZ" });
    const r = await db.as(a).try(`update accounts set role = 'coach' where id = '${a}' returning role, coach_requested`);
    expect(r.error).toBeNull();
    expect(r.rows[0]).toMatchObject({ role: "parent", coach_requested: true });
  });

  it("użytkownik nie wycofa ani nie sfałszuje flagi prośby bez zmiany roli", async () => {
    const a = await db.user();
    await db.as(a).try(`update accounts set coach_requested = true where id = '${a}'`);
    expect((await roleOf(a)).coach_requested).toBe(false);
  });

  it("administrator zatwierdza trenera, a trener zyskuje zakładkę klubu (rola coach)", async () => {
    const admin = await db.user({ admin: true });
    const a = await db.user({ club: "ATZ" });
    await db.as(a).try(`update accounts set role = 'coach' where id = '${a}'`);
    const r = await db.as(admin).try(`update accounts set role = 'coach', coach_requested = false where id = '${a}' returning role, coach_requested`);
    expect(r.rows[0]).toMatchObject({ role: "coach", coach_requested: false });
  });

  it("zatwierdzony trener może zmienić rolę na inną, ale z powrotem na coach już nie sam", async () => {
    const coach = await db.user({ role: "coach", club: "ATZ" });
    await db.as(coach).try(`update accounts set role = 'parent' where id = '${coach}'`);
    expect((await roleOf(coach)).role).toBe("parent");
    await db.as(coach).try(`update accounts set role = 'coach' where id = '${coach}'`);
    expect((await roleOf(coach)).role).toBe("parent");
  });

  it("administrator może nadać verified i is_admin innemu kontu", async () => {
    const admin = await db.user({ admin: true });
    const a = await db.user();
    const r = await db.as(admin).try(`update accounts set verified = true, verified_at = now(), is_admin = true where id = '${a}' returning verified, is_admin`);
    expect(r.rows[0]).toMatchObject({ verified: true, is_admin: true });
  });

  it("administrator nie traci uprawnień przy zwykłej edycji własnego profilu", async () => {
    const admin = await db.user({ admin: true });
    await db.as(admin).try(`update accounts set city = 'Gliwice' where id = '${admin}'`);
    expect((await db.sql(`select is_admin from accounts where id = '${admin}'`)).rows[0].is_admin).toBe(true);
  });

  it("kontekst serwerowy (service_role, SQL Editor) może zmieniać pola uprawnień", async () => {
    const a = await db.user();
    await db.service().try(`update accounts set verified = true, status = 'suspended' where id = '${a}'`);
    expect((await db.sql(`select verified, status from accounts where id = '${a}'`)).rows[0]).toMatchObject({ verified: true, status: "suspended" });
  });

  it("zwykła edycja profilu (imię, miasto, telefon, klub) nadal działa", async () => {
    const a = await db.user();
    const r = await db.as(a).try(`update accounts set full_name = 'Nowe', club_name = 'Klub', phone = '1' where id = '${a}' returning full_name, club_name`);
    expect(r.rows[0]).toMatchObject({ full_name: "Nowe", club_name: "Klub" });
  });
});

describe("uprawnienia administratora", () => {
  it("administrator widzi wszystkie konta", async () => {
    const admin = await db.user({ admin: true });
    await db.user();
    await db.user();
    expect((await db.as(admin).q(`select id from accounts`)).length).toBe(3);
  });

  it("administrator może zawiesić cudze konto", async () => {
    const admin = await db.user({ admin: true });
    const b = await db.user();
    const r = await db.as(admin).try(`update accounts set status = 'suspended' where id = '${b}' returning status`);
    expect(r.rows[0]?.status).toBe("suspended");
  });

  it("zwykły użytkownik nie może wywołać admin_stats()", async () => {
    const a = await db.user();
    const r = await db.as(a).try(`select admin_stats()`);
    expect(r.error).not.toBeNull();
  });

  it("administrator może wywołać admin_stats()", async () => {
    const admin = await db.user({ admin: true });
    const r = await db.as(admin).try(`select admin_stats() as s`);
    expect(r.error).toBeNull();
    expect(r.rows[0].s).toBeTypeOf("object");
  });

  it("zwykły użytkownik nie czyta ani nie zmienia zgłoszeń nadużyć innych osób", async () => {
    const a = await db.user();
    const b = await db.user();
    const c = await db.user();
    await db.exec(`insert into reports(reporter_account_id, reported_account_id, reason) values ('${b}', '${c}', 'spam')`);
    expect(await db.as(a).q(`select id from reports`)).toEqual([]);
    expect(isDenied(await db.as(a).try(`update reports set status = 'resolved' returning id`))).toBe(true);
  });

  it("zgłaszający widzi własne zgłoszenie, ale nie może zmienić jego statusu", async () => {
    const b = await db.user();
    const c = await db.user();
    await db.exec(`insert into reports(reporter_account_id, reported_account_id, reason) values ('${b}', '${c}', 'spam')`);
    expect((await db.as(b).q(`select id from reports`)).length).toBe(1);
    expect(isDenied(await db.as(b).try(`update reports set status = 'resolved' returning id`))).toBe(true);
  });

  it("zwykły użytkownik nie może dodać turnieju (import jest tylko dla administratora)", async () => {
    const a = await db.user();
    for (const source of ["otk", "itf", "manual", "tennis_europe"]) {
      const r = await db.as(a).try(
        `insert into tournaments(source, external_id, name, city, starts_on, ends_on) values ('${source}', 'x-${source}', 'Fałszywy', 'Zabrze', '2099-01-01', '2099-01-02')`
      );
      expect(r.error, `źródło ${source}`).not.toBeNull();
    }
  });

  it("administrator może dodać turniej ITF i ręczny, ale nie nadpisze importu OTK", async () => {
    const admin = await db.user({ admin: true });
    const ok = await db.as(admin).try(
      `insert into tournaments(source, external_id, name, city, starts_on, ends_on) values ('itf', 'itf-1', 'ITF Test', 'Zabrze', '2099-01-01', '2099-01-02')`
    );
    expect(ok.error).toBeNull();
    const bad = await db.as(admin).try(
      `insert into tournaments(source, external_id, name, city, starts_on, ends_on) values ('otk', 'otk-1', 'OTK Test', 'Zabrze', '2099-01-01', '2099-01-02')`
    );
    expect(bad.error).not.toBeNull();
  });

  it("zwykły użytkownik nie może oznaczyć zgłoszenia błędu jako rozwiązanego", async () => {
    const a = await db.user();
    await db.exec(`insert into bug_reports(description) values ('coś nie działa')`);
    expect(isDenied(await db.as(a).try(`update bug_reports set resolved = true returning id`))).toBe(true);
  });

  it("administrator może oznaczyć zgłoszenie błędu jako rozwiązane", async () => {
    const admin = await db.user({ admin: true });
    await db.exec(`insert into bug_reports(description) values ('coś nie działa')`);
    const r = await db.as(admin).try(`update bug_reports set resolved = true returning resolved`);
    expect(r.rows[0]?.resolved).toBe(true);
  });
});

describe("ustawienia kalkulatora kosztów są tylko dla administratora", () => {
  it("zwykły użytkownik nie czyta parametrów kalkulatora", async () => {
    const a = await db.user();
    expect(await db.as(a).q(`select * from ride_cost_settings`)).toEqual([]);
  });

  it("anonim nie czyta parametrów kalkulatora", async () => {
    expect(await db.anon().q(`select * from ride_cost_settings`)).toEqual([]);
  });

  it("zwykły użytkownik nie zmienia ceny paliwa", async () => {
    const a = await db.user();
    const r = await db.as(a).try(`update ride_cost_settings set fuel_price_pln = 1 returning id`);
    expect(isDenied(r)).toBe(true);
    expect((await db.sql(`select fuel_price_pln from ride_cost_settings`)).rows[0].fuel_price_pln).toBe("8.10");
  });

  it("administrator czyta i zmienia parametry", async () => {
    const admin = await db.user({ admin: true });
    expect((await db.as(admin).q(`select fuel_price_pln from ride_cost_settings`)).length).toBe(1);
    const r = await db.as(admin).try(`update ride_cost_settings set fuel_price_pln = 7.5 returning fuel_price_pln`);
    expect(r.error).toBeNull();
  });

  it("administrator nie ustawi nieprawdopodobnych wartości (ograniczenia CHECK)", async () => {
    const admin = await db.user({ admin: true });
    for (const set of ["fuel_price_pln = 0.5", "fuel_price_pln = 99", "consumption_l_per_100km = 1", "road_factor = 0.5", "share_divisor = 0", "round_to_pln = 0"]) {
      const r = await db.as(admin).try(`update ride_cost_settings set ${set}`);
      expect(r.error, set).not.toBeNull();
    }
  });
});
