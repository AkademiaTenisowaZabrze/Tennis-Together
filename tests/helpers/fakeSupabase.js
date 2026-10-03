// Atrapa klienta Supabase dla testów interfejsu: dane w pamięci, rejestr operacji
// i proste odwzorowanie dwóch triggerów z migracji 0041 (kwota oferty i prośby).
// To NIE jest test bazy (to robi tests/db), tylko sposób na przeklikanie ekranów.
export const ME = "acc-me";
export const OTHER = "acc-other";

const state = { db: {}, rpc: {}, log: [], session: null, authCalls: [], authResults: {}, seq: 0, authCb: null, failures: [] };
const nowIso = () => new Date().toISOString();
const nid = (p) => `${p}-${++state.seq}`;

export const CITIES = [
  { city: "Zabrze", lat: 50.32, lng: 18.78 },
  { city: "Gliwice", lat: 50.29, lng: 18.67 },
  { city: "Warszawa", lat: 52.23, lng: 21.01 },
  { city: "Gdańsk", lat: 54.35, lng: 18.65 },
  { city: "Katowice", lat: 50.26, lng: 19.02 },
  { city: "Sopot", lat: 54.44, lng: 18.56 },
];

export function defaultData() {
  return {
    accounts: [
      { id: ME, role: "parent", full_name: "Test Rodzic", city: "Zabrze", club_name: "ATZ", status: "active", is_admin: false, avatar_url: null, verified: false },
      { id: OTHER, role: "parent", full_name: "Anna Kierowca", city: "Gliwice", club_name: "ATZ", status: "active", avatar_url: null, verified: true },
    ],
    city_coordinates: CITIES.map((c) => ({ ...c })),
    players: [{ id: "pl-1", owner_account_id: ME, first_name: "Kuba", last_name: "Test", birth_year: 2014, category: "U12", club_name: "ATZ", city: "Zabrze", pzt_login: null, created_at: nowIso() }],
    tournaments: [
      { id: "t-1", source: "otk", name: "Turniej U12 Warszawa", city: "Warszawa", category: "U12", starts_on: "2099-10-20", ends_on: "2099-10-23" },
      { id: "t-2", source: "otk", name: "Turniej U12 Gdańsk", city: "Gdańsk", category: "U12", starts_on: "2099-11-05", ends_on: "2099-11-08" },
      { id: "t-3", source: "tennis_europe", name: "Turniej U14 Sopot", city: "Sopot", category: "U14", starts_on: "2099-11-12", ends_on: "2099-11-15" },
    ],
    trips: [
      { id: "trip-me-1", player_id: "pl-1", tournament_id: "t-1", created_by_account_id: ME, departure_city: "Zabrze", departure_date: "2099-10-19", return_date: "2099-10-23", status: "planning", created_at: nowIso() },
      { id: "trip-other-1", player_id: "pl-x", tournament_id: "t-1", created_by_account_id: OTHER, departure_city: "Gliwice", departure_date: "2099-10-19", return_date: "2099-10-23", status: "planning", created_at: nowIso() },
      { id: "trip-other-2", player_id: "pl-y", tournament_id: "t-2", created_by_account_id: OTHER, departure_city: "Katowice", departure_date: "2099-11-04", return_date: "2099-11-08", status: "planning", created_at: nowIso() },
    ],
    ride_offers: [
      { id: "ro-1", trip_id: "trip-other-1", free_seats: 3, luggage_space: "2 torby", cost_refund: true, cost_terms_accepted: true, cost_per_person_pln: 95, cost_split_suggestion: null, created_at: nowIso() },
      { id: "ro-2", trip_id: "trip-other-2", free_seats: 2, luggage_space: null, cost_refund: false, cost_terms_accepted: false, cost_per_person_pln: null, cost_split_suggestion: null, created_at: nowIso() },
    ],
    ride_requests: [], ride_join_requests: [], ride_pings: [], lodging_offers: [], lodging_join_requests: [],
    lodging_host_offers: [], lodging_host_requests: [], conversations: [], conversation_participants: [], messages: [],
    consents: [], ratings: [], device_tokens: [], signup_attempts: [],
    data_sync_status: [{ key: "tournaments", last_synced_at: nowIso(), last_count: 3 }],
  };
}

export function reset(overrides = {}) {
  state.db = { ...defaultData(), ...overrides };
  state.avatarFiles = undefined;
  state.rpc = {
    delete_my_account: () => ({ data: null, error: null }),
    signup_attempts_last_hour: () => ({
      data: (state.db.signup_attempts ?? []).filter((r) => r.created_at && Date.now() - new Date(r.created_at).getTime() < 3600e3).length,
      error: null,
    }),
  };
  state.log = [];
  state.session = { user: { id: ME, email: "test@example.com" }, access_token: "x" };
  state.authCalls = [];
  state.authResults = {};
  state.seq = 0;
  state.failures = [];
}
reset();

export const fake = {
  get db() { return state.db; },
  get log() { return state.log; },
  get authCalls() { return state.authCalls; },
  rpcHandlers: new Proxy({}, { get: (_, k) => state.rpc[k], set: (_, k, v) => ((state.rpc[k] = v), true) }),
  setSession: (s) => { state.session = s; },
  // wywołuje zdarzenie logowania/odświeżenia tokenu tak, jak zrobiłby to Supabase
  emitAuth: (event, session) => state.authCb?.(event, session),
  // następna operacja (table, op) zakończy się podanym błędem (np. { code: "23505" })
  failNext: (table, op, error) => state.failures.push({ table, op, error }),
  setAuthResult: (name, result) => { state.authResults[name] = result; },
  setAvatarFiles: (files) => { state.avatarFiles = files; },
  reset,
};

// ── "Embedy", które PostgREST dociągałby sam ─────────────────────────────
const find = (table, id) => state.db[table]?.find((r) => r.id === id);
const playerOf = (id) => find("players", id) ?? { first_name: id === "pl-x" ? "Marek" : "Ola", last_name: "Inny" };
const tripEmbed = (t) => (t ? { ...t, tournaments: find("tournaments", t.tournament_id), players: playerOf(t.player_id) } : null);

function hydrate(table, row) {
  const r = { ...row };
  if (table === "trips") return tripEmbed(r);
  if (table === "ride_offers" || table === "ride_requests") r.trips = tripEmbed(find("trips", r.trip_id));
  if (table === "lodging_offers") r.trips = tripEmbed(find("trips", r.trip_id));
  if (table === "ride_join_requests") {
    r.requester_trip = tripEmbed(find("trips", r.requester_trip_id));
    const o = find("ride_offers", r.ride_offer_id);
    r.ride_offers = o ? hydrate("ride_offers", o) : null;
  }
  if (table === "lodging_join_requests") {
    r.requester_trip = tripEmbed(find("trips", r.requester_trip_id));
    const o = find("lodging_offers", r.lodging_offer_id);
    r.lodging_offers = o ? hydrate("lodging_offers", o) : null;
  }
  if (table === "lodging_host_offers") r.tournaments = find("tournaments", r.tournament_id);
  if (table === "lodging_host_requests") {
    r.requester_trip = tripEmbed(find("trips", r.requester_trip_id));
    const o = find("lodging_host_offers", r.host_offer_id);
    r.lodging_host_offers = o ? hydrate("lodging_host_offers", o) : null;
  }
  if (table === "consents") r.players = playerOf(r.player_id);
  return r;
}

function haversine(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").trim();

export const calcSettings = { cons: 6.5, fuel: 8.1, road: 1.25, divisor: 4, roundTo: 5 };
export function suggestion(tripId) {
  const t = find("trips", tripId);
  if (!t) return [];
  const tn = find("tournaments", t.tournament_id);
  const c1 = state.db.city_coordinates.find((c) => norm(c.city) === norm(t.departure_city));
  const c2 = state.db.city_coordinates.find((c) => norm(c.city) === norm(tn.city));
  if (!c1 || !c2) return [];
  const km = haversine(c1, c2) * calcSettings.road;
  const total = km * 2 * (calcSettings.cons / 100) * calcSettings.fuel;
  const per = Math.max(calcSettings.roundTo, Math.round(total / calcSettings.divisor / calcSettings.roundTo) * calcSettings.roundTo);
  return [{ distance_km: Math.round(km), per_person_pln: per }];
}

// ── Konstruktor zapytań ──────────────────────────────────────────────────
function query(table) {
  const st = { op: "select", filters: [], payload: null, single: null, head: false, count: false };
  const entry = { table, op: "select", payload: null, filters: [] };
  const q = {
    select: (_cols, opts) => { if (opts?.head) st.head = true; if (opts?.count) st.count = true; return q; },
    insert: (p) => ((st.op = "insert"), (st.payload = p), q),
    update: (p) => ((st.op = "update"), (st.payload = p), q),
    upsert: (p) => ((st.op = "insert"), (st.payload = p), q),
    delete: () => ((st.op = "delete"), q),
    eq: (c, v) => (st.filters.push((r) => r[c] === v), entry.filters.push([c, "eq", v]), q),
    neq: (c, v) => (st.filters.push((r) => r[c] !== v), q),
    in: (c, vs) => (st.filters.push((r) => vs.includes(r[c])), q),
    is: (c, v) => (st.filters.push((r) => (r[c] ?? null) === v), q),
    gte: () => q, lte: () => q, gt: () => q, lt: () => q, not: () => q, or: () => q, ilike: () => q, contains: () => q,
    order: () => q, limit: () => q,
    single: () => ((st.single = "one"), q),
    maybeSingle: () => ((st.single = "maybe"), q),
    then: (res, rej) => Promise.resolve().then(run).then(res, rej),
  };
  function run() {
    entry.op = st.op;
    entry.payload = st.payload;
    const fi = state.failures.findIndex((f) => f.table === table && f.op === st.op);
    if (fi >= 0) return finish({ data: null, error: state.failures.splice(fi, 1)[0].error });
    const rows = state.db[table] ?? (state.db[table] = []);
    let out = [];
    if (st.op === "insert") {
      const list = Array.isArray(st.payload) ? st.payload : [st.payload];
      for (const p of list) {
        const row = { id: nid(table), created_at: nowIso(), status: "pending", ...p };
        if (table === "ride_offers") {
          // odwzorowanie triggera set_ride_offer_cost (0041)
          if (row.cost_refund) {
            if (!row.cost_terms_accepted) return finish({ data: null, error: { message: "Aby żądać zwrotu kosztów, potwierdź zgodę na kwotę z kalkulatora." } });
            const s = suggestion(row.trip_id)[0];
            if (!s) return finish({ data: null, error: { message: "Nie można wyliczyć kwoty dla tej trasy (miasto spoza listy). Dodaj ofertę bez zwrotu kosztów." } });
            row.cost_per_person_pln = s.per_person_pln;
          } else {
            row.cost_terms_accepted = false;
            row.cost_per_person_pln = null;
          }
        }
        if (table === "ride_join_requests") row.agreed_cost_pln = find("ride_offers", row.ride_offer_id)?.cost_per_person_pln ?? null; // set_agreed_ride_cost
        rows.push(row);
        out.push(row);
      }
    } else if (st.op === "update") {
      for (const r of rows.filter((r) => st.filters.every((f) => f(r)))) {
        const keep = table === "ride_join_requests" ? r.agreed_cost_pln : undefined;
        Object.assign(r, st.payload);
        if (table === "ride_join_requests") r.agreed_cost_pln = keep;
        out.push(r);
      }
    } else if (st.op === "delete") {
      state.db[table] = rows.filter((r) => !st.filters.every((f) => f(r)));
      return finish({ data: null, error: null });
    } else {
      out = rows.filter((r) => st.filters.every((f) => f(r)));
    }
    out = out.map((r) => hydrate(table, r));
    if (st.head) return finish({ data: null, count: out.length, error: null });
    if (st.single === "one") return finish(out[0] ? { data: out[0], error: null } : { data: null, error: { message: "no rows" } });
    if (st.single === "maybe") return finish({ data: out[0] ?? null, error: null });
    return finish({ data: out, count: out.length, error: null });
  }
  function finish(r) {
    state.log.push({ ...entry, error: r.error?.message ?? null });
    return r;
  }
  return q;
}

export const supabase = {
  from: (t) => query(t),
  rpc: (name, args) => {
    state.log.push({ table: null, op: "rpc", name, payload: args });
    if (state.rpc[name]) return Promise.resolve(state.rpc[name](args));
    if (name === "ride_cost_suggestion") return Promise.resolve({ data: suggestion(args.p_trip_id), error: null });
    if (name === "trip_arrangements") return Promise.resolve({ data: [], error: null });
    if (name === "account_rating") return Promise.resolve({ data: [{ avg_rating: 4.8, rating_count: 5 }], error: null });
    if (name === "match_profile") return Promise.resolve({ data: [{ full_name: "Anna Kierowca", avatar_url: null, verified: true }], error: null });
    return Promise.resolve({ data: [], error: null });
  },
  auth: {
    getSession: () => Promise.resolve({ data: { session: state.session } }),
    onAuthStateChange: (cb) => ((state.authCb = cb), { data: { subscription: { unsubscribe() { state.authCb = null; } } } }),
    signOut: () => (state.authCalls.push(["signOut"]), Promise.resolve({})),
    signUp: (a) => (state.authCalls.push(["signUp", a]), Promise.resolve(state.authResults.signUp ?? { data: { user: { id: "new" }, session: null }, error: null })),
    signInWithPassword: (a) => (state.authCalls.push(["signIn", a]), Promise.resolve(state.authResults.signIn ?? { data: {}, error: null })),
    resetPasswordForEmail: (...a) => (state.authCalls.push(["reset", ...a]), Promise.resolve(state.authResults.reset ?? { error: null })),
    updateUser: (a) => (state.authCalls.push(["update", a]), Promise.resolve(state.authResults.update ?? { error: null })),
  },
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }), upload: () => Promise.resolve({ error: null }), list: () => Promise.resolve({ data: state.avatarFiles ?? [], error: null }), remove: (paths) => (state.log.push({ table: null, op: "storage_remove", payload: paths }), Promise.resolve({ error: null })) }) },
  functions: { invoke: (...a) => (state.log.push({ table: null, op: "invoke", payload: a }), Promise.resolve(state.rpc.__invoke?.(...a) ?? { data: { found: false }, error: null })) },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel() {},
};
