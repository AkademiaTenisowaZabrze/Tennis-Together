// Pomocnik testów bazy danych: prawdziwe migracje Tennis Together uruchomione
// w lokalnym Postgresie (PGlite). Role anon / authenticated / service_role
// i funkcja auth.uid() zachowują się jak w Supabase, więc polityki RLS,
// triggery i funkcje SECURITY DEFINER są testowane naprawdę, nie "na sucho".
import { PGlite } from "@electric-sql/pglite";
import crypto from "node:crypto";
import fs from "node:fs";
import { TEMPLATE_FILE } from "../db/globalSetup.mjs";

const SQL_STR = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

export async function openDb() {
  const raw = new PGlite({ loadDataDir: new Blob([fs.readFileSync(TEMPLATE_FILE)]) });
  await raw.waitReady;

  const run = async (sql) => {
    try {
      const r = await raw.query(sql);
      return { rows: r.rows, count: r.affectedRows ?? r.rows.length, error: null };
    } catch (e) {
      return { rows: [], count: 0, error: { code: e.code ?? null, message: String(e.message) } };
    }
  };

  // Wykonanie zapytania "jako" dana rola; claim "sub" udaje token JWT.
  async function withRole(role, uid, sql) {
    await raw.exec(`set role ${role};`);
    await raw.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)`, [
      uid ?? "",
      role,
    ]);
    try {
      return await run(sql);
    } finally {
      await raw.exec(`reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);`);
    }
  }

  const client = (role, uid) => ({
    // wynik z błędem w polu .error (nie rzuca) - testy sprawdzają jedno i drugie
    try: (sql) => withRole(role, uid, sql),
    // zwraca wiersze, a błąd rzuca
    async q(sql) {
      const r = await withRole(role, uid, sql);
      if (r.error) throw new Error(`${r.error.code ?? ""} ${r.error.message}\n  SQL: ${sql}`);
      return r.rows;
    },
    async one(sql) {
      const rows = await this.q(sql);
      return rows[0] ?? null;
    },
  });

  const db = {
    raw,
    exec: (sql) => raw.exec(sql),
    sql: run,
    as: (uid) => client("authenticated", uid),
    anon: () => client("anon", null),
    service: () => client("service_role", null),
    close: () => raw.close(),
    lit: SQL_STR,

    async calls(eventFilter) {
      const r = await raw.query(`select body from net._calls order by id`);
      const bodies = r.rows.map((x) => x.body);
      return eventFilter ? bodies.filter((b) => b.event === eventFilter) : bodies;
    },
    clearCalls: () => raw.exec(`delete from net._calls`),

    // Czyści dane testowe, zostawia tabele referencyjne z migracji (miasta, domyślne ustawienia kalkulatora).
    async reset() {
      await raw.exec(`
        truncate auth.users, tournaments, bug_reports, signup_attempts, push_throttle,
                 data_sync_status, private_config, net._calls cascade;
        update ride_cost_settings set consumption_l_per_100km = 6.5, fuel_price_pln = 8.10,
          road_factor = 1.25, round_trip = true, share_divisor = 4, round_to_pln = 5, fuel_price_auto = true;
      `);
    },
  };

  // ── Generatory danych (jako superużytkownik, z pominięciem RLS) ────────────
  const uuid = () => crypto.randomUUID();
  let n = 0;

  db.user = async (o = {}) => {
    const id = o.id ?? uuid();
    n++;
    await raw.exec(`insert into auth.users(id, email) values (${SQL_STR(id)}, ${SQL_STR(o.email ?? `u${n}@test.local`)});`);
    await raw.exec(`insert into accounts(id, role, full_name, club_name, city, status, is_admin, phone)
      values (${SQL_STR(id)}, ${SQL_STR(o.role ?? "parent")}, ${SQL_STR(o.name ?? `Użytkownik ${n}`)},
              ${SQL_STR(o.club ?? null)}, ${SQL_STR(o.city ?? null)}, ${SQL_STR(o.status ?? "active")},
              ${o.admin ? "true" : "false"}, ${SQL_STR(o.phone ?? null)});`);
    return id;
  };

  db.player = async (ownerId, o = {}) => {
    const id = o.id ?? uuid();
    await raw.exec(`insert into players(id, owner_account_id, first_name, last_name, birth_year, category, club_name, city)
      values (${SQL_STR(id)}, ${SQL_STR(ownerId)}, ${SQL_STR(o.first ?? "Kuba")}, ${SQL_STR(o.last ?? "Testowy")},
              ${o.year ?? 2014}, ${SQL_STR(o.category ?? "U12")}, ${SQL_STR(o.club ?? null)}, ${SQL_STR(o.city ?? null)});`);
    return id;
  };

  db.tournament = async (o = {}) => {
    const id = o.id ?? uuid();
    n++;
    await raw.exec(`insert into tournaments(id, source, external_id, name, city, category, starts_on, ends_on)
      values (${SQL_STR(id)}, ${SQL_STR(o.source ?? "otk")}, ${SQL_STR(o.external ?? `ext-${n}`)}, ${SQL_STR(o.name ?? `Turniej ${n}`)},
              ${SQL_STR(o.city ?? "Warszawa")}, ${SQL_STR(o.category ?? "U12")},
              ${SQL_STR(o.starts ?? "2099-10-20")}, ${SQL_STR(o.ends ?? "2099-10-23")});`);
    return id;
  };

  db.trip = async (accountId, playerId, tournamentId, o = {}) => {
    const id = o.id ?? uuid();
    await raw.exec(`insert into trips(id, player_id, tournament_id, created_by_account_id, departure_city, status)
      values (${SQL_STR(id)}, ${SQL_STR(playerId)}, ${SQL_STR(tournamentId)}, ${SQL_STR(accountId)},
              ${SQL_STR(o.city ?? "Zabrze")}, ${SQL_STR(o.status ?? "planning")});`);
    return id;
  };

  // Wygodny skrót: konto + zawodnik + wyjazd na dany turniej.
  db.family = async (tournamentId, o = {}) => {
    const account = await db.user({ name: o.name, club: o.club, role: o.role, city: o.accountCity });
    const player = await db.player(account, { club: o.club, city: o.city, first: o.first });
    const trip = await db.trip(account, player, tournamentId, { city: o.city ?? "Zabrze", status: o.status });
    return { account, player, trip };
  };

  // Oferta przejazdu. Przy cost_refund trigger liczy kwotę jako właściciel wyjazdu.
  db.rideOffer = async (tripId, ownerId, o = {}) => {
    const id = o.id ?? uuid();
    await raw.exec(`select set_config('request.jwt.claim.sub', ${SQL_STR(ownerId)}, false);`);
    const r = await run(`insert into ride_offers(id, trip_id, free_seats, cost_refund, cost_terms_accepted)
      values (${SQL_STR(id)}, ${SQL_STR(tripId)}, ${o.seats ?? 3}, ${o.refund ? "true" : "false"}, ${o.refund ? "true" : "false"});`);
    await raw.exec(`select set_config('request.jwt.claim.sub', '', false);`);
    if (r.error) throw new Error(r.error.message);
    return id;
  };

  db.joinRequest = async (offerId, requesterTripId, status = "pending") => {
    const id = uuid();
    await raw.exec(`insert into ride_join_requests(id, ride_offer_id, requester_trip_id, status)
      values (${SQL_STR(id)}, ${SQL_STR(offerId)}, ${SQL_STR(requesterTripId)}, ${SQL_STR(status)});`);
    return id;
  };

  return db;
}

// Sprawdza, że operacja została odrzucona przez RLS/trigger (błąd lub 0 zmienionych wierszy).
export function isDenied(res) {
  if (res.error) return true;
  return (res.count ?? res.rows.length) === 0;
}
