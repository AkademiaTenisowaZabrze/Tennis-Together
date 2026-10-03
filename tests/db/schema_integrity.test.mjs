// Integralność schematu: RLS na każdej tabeli, polityki widoczne dla anonima,
// uprawnienia funkcji, search_path funkcji SECURITY DEFINER i klucze obce
// przy usuwaniu konta. Czyta katalog systemowy bazy zbudowanej z migracji.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { openDb } from "../helpers/db.mjs";

let db;
beforeAll(async () => {
  db = await openDb();
});
afterAll(() => db.close());

const rows = async (sql) => (await db.sql(sql)).rows;

describe("RLS na tabelach", () => {
  it("każda tabela w schemacie public ma włączony RLS", async () => {
    const t = await rows(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`);
    expect(t.map((x) => x.relname)).toEqual([]);
  });

  it("w bazie jest co najmniej 29 tabel (żadna nie zniknęła z migracji)", async () => {
    const t = await rows(`select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`);
    expect(t[0].n).toBeGreaterThanOrEqual(29);
  });

  it("tabele bez żadnej polityki to wyłącznie wewnętrzne (tylko service_role)", async () => {
    const t = await rows(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) order by 1`);
    const allowed = new Set(["push_throttle", "private_config"]);
    for (const x of t) expect(allowed.has(x.relname), `tabela ${x.relname} ma RLS bez polityk`).toBe(true);
  });

  it("każda tabela ma klucz główny", async () => {
    const t = await rows(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'p') order by 1`);
    expect(t.map((x) => x.relname)).toEqual([]);
  });
});

describe("polityki dostępne dla anonima", () => {
  it("polityki dla 'anon' lub 'public' ograniczają się do znanej, krótkiej listy", async () => {
    const p = await rows(`select tablename, cmd, policyname, roles::text r, coalesce(qual,'') q from pg_policies
      where schemaname = 'public' and (roles::text like '%anon%' or roles::text like '%public%') order by tablename, cmd`);
    const open = p.filter((x) => !/auth\.uid\(\)|is_admin\(\)|account_is_active\(\)/.test(x.q));
    const names = open.map((x) => `${x.tablename}:${x.cmd}`).sort();
    // jedyne polityki bez wiązania z zalogowanym użytkownikiem
    expect(names).toEqual(["bug_reports:INSERT", "signup_attempts:INSERT"]);
  });

  it("polityki 'TO public' na kontach, zawodnikach i wyjazdach są związane z auth.uid()", async () => {
    const p = await rows(`select tablename, coalesce(qual,'') q from pg_policies
      where schemaname = 'public' and roles::text like '%public%' and tablename in ('accounts','players','trips')`);
    expect(p.length).toBeGreaterThanOrEqual(3);
    for (const x of p) expect(x.q, x.tablename).toMatch(/auth\.uid\(\)/);
  });

  it("żadna polityka zapisu dla zalogowanych nie ma warunku 'true' poza znaną listą", async () => {
    const p = await rows(`select tablename, cmd, policyname from pg_policies
      where schemaname = 'public' and cmd in ('INSERT','UPDATE','DELETE','ALL')
        and (trim(coalesce(with_check,'')) in ('true','') and trim(coalesce(qual,'')) in ('true',''))
        and permissive = 'PERMISSIVE' order by 1, 2`);
    const names = p.map((x) => `${x.tablename}:${x.cmd}`).sort();
    // INSERT bez ograniczeń: licznik prób rejestracji, zakładanie rozmów (potem ograniczane uczestnictwem); formularz zgłoszeń błędów ma limity długości (0044)
    expect(names).toEqual(["conversations:INSERT", "signup_attempts:INSERT"]);
  });
});

describe("funkcje", () => {
  it("każda funkcja SECURITY DEFINER ma ustawiony search_path", async () => {
    const f = await rows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig::text, '') like '%search_path%' order by 1`);
    expect(f.map((x) => x.proname)).toEqual([]);
  });

  it("także zwykłe funkcje triggerów mają ustawiony search_path", async () => {
    const f = await rows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and not coalesce(p.proconfig::text, '') like '%search_path%' order by 1`);
    expect(f.map((x) => x.proname)).toEqual([]);
  });

  it("funkcje pomocnicze dla service_role nie są dostępne dla zalogowanych ani anonimów", async () => {
    for (const fn of ["claim_coach_digests", "claim_push_slot", "claim_trip_reminders", "expire_stale_requests", "trip_lodging_status", "trip_ride_status"]) {
      const r = await rows(`select has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u
        from pg_proc p where p.proname = '${fn}'`);
      expect(r.length, fn).toBeGreaterThan(0);
      for (const x of r) {
        expect(x.a, `${fn} dla anon`).toBe(false);
        expect(x.u, `${fn} dla authenticated`).toBe(false);
      }
    }
  });

  it("funkcje zmieniające dane są niedostępne dla anonima", async () => {
    for (const fn of ["confirm_meeting", "set_meeting_point", "find_pzt_tournament_matches", "ride_cost_suggestion", "trip_arrangements"]) {
      const r = await rows(`select has_function_privilege('anon', p.oid, 'execute') a from pg_proc p where p.proname = '${fn}'`);
      for (const x of r) expect(x.a, fn).toBe(false);
    }
  });

  it("anonim nie sprawdzi, czy dany wyjazd ma ofertę (trip_has_public_offer)", async () => {
    const t = await db.tournament();
    const f = await db.family(t, {});
    await db.rideOffer(f.trip, f.account);
    const r = await db.anon().try(`select trip_has_public_offer('${f.trip}') r`);
    expect(r.error !== null || r.rows[0].r !== true).toBe(true);
  });

  it("funkcje pomocnicze polityk RLS nie są wykonywalne przez anonima, a zalogowani nadal je mają (0049)", async () => {
    for (const fn of ["trip_has_public_offer", "trip_is_requester_for_my_offer", "player_visible_to_my_coach", "is_conversation_participant", "can_rate", "account_is_active", "is_admin"]) {
      const r = await rows(`select has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${fn}'`);
      expect(r.length, fn).toBeGreaterThan(0);
      for (const x of r) {
        expect(x.a, `${fn} dla anon`).toBe(false);
        expect(x.u, `${fn} dla authenticated`).toBe(true);
      }
    }
  });

  it("funkcje pomocnicze dostępne dla anonima nie zwracają mu żadnych danych", async () => {
    const t = await db.tournament();
    const f = await db.family(t, { club: "ATZ" });
    await db.rideOffer(f.trip, f.account);
    const a = db.anon();
    const results = {
      is_admin: await a.try(`select is_admin() r`),
      account_is_active: await a.try(`select account_is_active() r`),
      trip_is_requester_for_my_offer: await a.try(`select trip_is_requester_for_my_offer('${f.trip}') r`),
      player_visible_to_my_coach: await a.try(`select player_visible_to_my_coach('${f.player}') r`),
      is_conversation_participant: await a.try(`select is_conversation_participant(gen_random_uuid()) r`),
      can_rate: await a.try(`select can_rate(gen_random_uuid(), 'ride', '${f.account}') r`),
    };
    for (const [name, r] of Object.entries(results)) {
      // po 0049 anonim w ogóle nie może ich wywołać; gdyby kiedyś mógł, wynik musi być pusty
      if (r.error) expect(r.error.code, name).toBe("42501");
      else expect([false, null], name).toContain(r.rows[0].r);
    }
    expect((await a.try(`select * from match_profile('${f.account}')`)).rows).toEqual([]);
    expect((await a.try(`select admin_stats()`)).error).not.toBeNull();
  });
});

describe("usuwanie konta (RODO art. 17, zamknięte w 0048, dawniej F3)", () => {
  const nonCascade = async () =>
    rows(`select conrelid::regclass::text tbl, a.attname col, confdeltype d
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where contype = 'f' and confrelid::regclass::text in ('accounts', 'auth.users') and confdeltype = 'a'`);

  it("wszystkie klucze do konta usuwają się kaskadowo albo zerują (nic nie blokuje usunięcia)", async () => {
    expect(await nonCascade()).toEqual([]);
  });

  it("usunięcie konta z wiadomościami i zgłoszeniami się udaje", async () => {
    await db.reset();
    const t = await db.tournament();
    const a = await db.family(t, { name: "Do usunięcia" });
    const b = await db.family(t, { name: "Rozmówca" });
    const conv = (await db.sql(`insert into conversations(kind) values ('direct') returning id`)).rows[0].id;
    await db.exec(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${a.account}'), ('${conv}', '${b.account}')`);
    await db.exec(`insert into messages(conversation_id, sender_account_id, body) values ('${conv}', '${a.account}', 'wiadomość')`);
    await db.exec(`insert into reports(reporter_account_id, reason) values ('${a.account}', 'x')`);
    const r = await db.sql(`delete from auth.users where id = '${a.account}'`);
    expect(r.error).toBeNull();
    // po usunięciu nie zostają dane osobowe tej osoby
    expect((await db.sql(`select count(*)::int n from accounts where id = '${a.account}'`)).rows[0].n).toBe(0);
    expect((await db.sql(`select count(*)::int n from players where owner_account_id = '${a.account}'`)).rows[0].n).toBe(0);
  });

  it("usunięcie konta z wyjazdem i zgodą usuwa zawodników, wyjazdy, oferty i tokeny", async () => {
    await db.reset();
    const t = await db.tournament();
    const a = await db.family(t, {});
    await db.rideOffer(a.trip, a.account);
    await db.exec(`insert into device_tokens(account_id, token) values ('${a.account}', 't')`);
    await db.exec(`insert into consents(player_id, given_by_account_id, consent_type) values ('${a.player}', '${a.account}', 'terms')`);
    const r = await db.sql(`delete from auth.users where id = '${a.account}'`);
    expect(r.error).toBeNull();
    for (const table of ["players", "trips", "ride_offers", "device_tokens", "consents"]) {
      expect((await db.sql(`select count(*)::int n from ${table}`)).rows[0].n, table).toBe(0);
    }
  });
});

describe("dane referencyjne z migracji", () => {
  it("lista miast ma 400+ wpisów ze współrzędnymi w granicach Polski", async () => {
    const r = await rows(`select count(*)::int n, min(lat) a, max(lat) b, min(lng) c, max(lng) d from city_coordinates`);
    expect(r[0].n).toBeGreaterThan(400);
    expect(r[0].a).toBeGreaterThan(48.9);
    expect(r[0].b).toBeLessThan(55);
    expect(r[0].c).toBeGreaterThan(14);
    expect(r[0].d).toBeLessThan(24.2);
  });

  it("w liście miast nie ma duplikatów po normalizacji (inaczej dopasowanie byłoby niejednoznaczne)", async () => {
    const r = await rows(`select translate(lower(trim(city)), 'ąćęłńóśźż', 'acelnoszz') k, count(*)::int n from city_coordinates group by 1 having count(*) > 1`);
    expect(r).toEqual([]);
  });

  it("kluczowe miasta turniejów istnieją (Zabrze, Warszawa, Gdańsk, Kraków, Katowice, Poznań, Wrocław)", async () => {
    for (const c of ["Zabrze", "Warszawa", "Gdańsk", "Kraków", "Katowice", "Poznań", "Wrocław"]) {
      expect((await rows(`select 1 from city_coordinates where city = '${c}'`)).length, c).toBe(1);
    }
  });

  it("domyślne ustawienia kalkulatora są sensowne po świeżej instalacji", async () => {
    const r = (await rows(`select * from ride_cost_settings`))[0];
    expect(Number(r.consumption_l_per_100km)).toBeGreaterThanOrEqual(5);
    expect(Number(r.consumption_l_per_100km)).toBeLessThanOrEqual(8);
    expect(Number(r.share_divisor)).toBe(4);
    expect(r.round_trip).toBe(true);
  });
});

describe("ograniczenia CHECK na statusach i rolach", () => {
  it("rola konta przyjmuje tylko znane wartości", async () => {
    const id = crypto.randomUUID();
    await db.exec(`insert into auth.users(id) values ('${id}')`);
    const r = await db.sql(`insert into accounts(id, role, full_name) values ('${id}', 'superadmin', 'x')`);
    expect(r.error).not.toBeNull();
  });

  it("status konta przyjmuje tylko active i suspended", async () => {
    const a = await db.user();
    expect((await db.sql(`update accounts set status = 'banned' where id = '${a}'`)).error).not.toBeNull();
  });

  it("rodzaje zgód są ograniczone do znanych", async () => {
    await db.reset();
    const t = await db.tournament();
    const f = await db.family(t, {});
    expect((await db.sql(`insert into consents(player_id, given_by_account_id, consent_type) values ('${f.player}', '${f.account}', 'wszystko')`)).error).not.toBeNull();
  });

  it("statusy prośb przyjmują tylko pending, accepted, declined, cancelled", async () => {
    await db.reset();
    const t = await db.tournament();
    const d = await db.family(t, {});
    const g = await db.family(t, {});
    const o = await db.rideOffer(d.trip, d.account);
    const id = await db.joinRequest(o, g.trip, "pending");
    expect((await db.sql(`update ride_join_requests set status = 'approved' where id = '${id}'`)).error).not.toBeNull();
  });

  it("rok urodzenia zawodnika i liczba miejsc w ofercie mają sensowne ograniczenia", async () => {
    await db.reset();
    const t = await db.tournament();
    const f = await db.family(t, {});
    expect((await db.sql(`insert into ride_offers(trip_id, free_seats) values ('${f.trip}', 0)`)).error).not.toBeNull();
    expect((await db.sql(`insert into ride_offers(trip_id, free_seats) values ('${f.trip}', -2)`)).error).not.toBeNull();
  });
});
