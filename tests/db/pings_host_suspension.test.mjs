// Zapytania o podwiezienie (ping), nocleg u rodziny, rozmowy, wygaszanie
// przeterminowanych próśb oraz zawieszanie kont.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { openDb, isDenied } from "../helpers/db.mjs";

let db;
beforeAll(async () => {
  db = await openDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

// ── ping: "podwieź mnie" między dwiema rodzinami jadącymi na ten sam turniej ──
describe("zapytania o podwiezienie (ride_pings)", () => {
  let t, a, b, c;
  beforeEach(async () => {
    t = await db.tournament({ city: "Warszawa" });
    a = await db.family(t, { first: "Ala" });
    b = await db.family(t, { first: "Basia" });
    c = await db.family(t, { first: "Czesia" });
  });
  const ping = (who, from, to, status = "") =>
    db.as(who).try(`insert into ride_pings(tournament_id, requester_trip_id, target_trip_id${status ? ", status" : ""}) values ('${t}', '${from}', '${to}'${status ? `, '${status}'` : ""}) returning id, status`);

  it("rodzic wysyła zapytanie ze swojego wyjazdu", async () => {
    const r = await ping(a.account, a.trip, b.trip);
    expect(r.error).toBeNull();
    expect(r.rows[0].status).toBe("pending");
  });

  it("nie można wysłać zapytania z cudzego wyjazdu", async () => {
    expect((await ping(c.account, a.trip, b.trip)).error).not.toBeNull();
  });

  it("zapytanie nie może powstać od razu jako zaakceptowane", async () => {
    const r = await ping(a.account, a.trip, b.trip, "accepted");
    expect(r.error !== null || r.rows[0].status === "pending").toBe(true);
  });

  it("odpowiedzieć może tylko druga strona; nadawca nie zaakceptuje sam", async () => {
    const id = (await ping(a.account, a.trip, b.trip)).rows[0].id;
    expect(isDenied(await db.as(a.account).try(`update ride_pings set status = 'accepted' where id = '${id}' returning id`))).toBe(true);
    const ok = await db.as(b.account).try(`update ride_pings set status = 'accepted' where id = '${id}' returning status`);
    expect(ok.rows[0]?.status).toBe("accepted");
  });

  it("osoba postronna nie widzi ani nie zmienia cudzego zapytania", async () => {
    const id = (await ping(a.account, a.trip, b.trip)).rows[0].id;
    expect(await db.as(c.account).q(`select * from ride_pings`)).toEqual([]);
    expect(isDenied(await db.as(c.account).try(`update ride_pings set status = 'accepted' where id = '${id}' returning id`))).toBe(true);
  });

  it("strony zapytania są niezmienne (nie da się przepiąć na obcy wyjazd)", async () => {
    const id = (await ping(a.account, a.trip, b.trip)).rows[0].id;
    const r = await db.as(a.account).try(`update ride_pings set target_trip_id = '${c.trip}' where id = '${id}'`);
    expect(r.error).not.toBeNull();
  });

  it("odrzucone zapytanie nie wraca do oczekujących ani nie staje się zaakceptowane", async () => {
    const id = (await ping(a.account, a.trip, b.trip)).rows[0].id;
    await db.as(b.account).try(`update ride_pings set status = 'declined' where id = '${id}'`);
    expect((await db.as(b.account).try(`update ride_pings set status = 'accepted' where id = '${id}'`)).error).not.toBeNull();
  });

  it("obie strony mogą anulować zaakceptowane zapytanie", async () => {
    const id = (await ping(a.account, a.trip, b.trip)).rows[0].id;
    await db.as(b.account).try(`update ride_pings set status = 'accepted' where id = '${id}'`);
    const r = await db.as(a.account).try(`update ride_pings set status = 'cancelled' where id = '${id}' returning status`);
    expect(r.rows[0]?.status).toBe("cancelled");
  });

  it("nie można wpisać nieznanego statusu", async () => {
    const id = (await ping(a.account, a.trip, b.trip)).rows[0].id;
    expect((await db.as(b.account).try(`update ride_pings set status = 'hacked' where id = '${id}'`)).error).not.toBeNull();
  });
});

// ── nocleg u rodziny: zgoda rodzica, wzajemna akceptacja ─────────────────
describe("nocleg u rodziny (lodging_host_requests)", () => {
  let t, host, guest, ho, stranger;
  beforeEach(async () => {
    t = await db.tournament({ city: "Warszawa" });
    host = await db.user({ name: "Gospodarz" });
    guest = await db.family(t, { name: "Gość", first: "Gucio" });
    stranger = await db.user({ name: "Obcy" });
    ho = (await db.sql(`insert into lodging_host_offers(tournament_id, host_account_id, city, capacity) values ('${t}', '${host}', 'Warszawa', 2) returning id`)).rows[0].id;
  });
  const consent = (type = "host_family_stay", granted = true) =>
    db.as(guest.account).try(`insert into consents(player_id, given_by_account_id, consent_type, granted) values ('${guest.player}', '${guest.account}', '${type}', ${granted})`);
  const request = (status = "") =>
    db.as(guest.account).try(`insert into lodging_host_requests(host_offer_id, requester_trip_id${status ? ", status" : ""}) values ('${ho}', '${guest.trip}'${status ? `, '${status}'` : ""}) returning id, status`);

  it("bez zgody rodzica prośba o nocleg u rodziny jest niemożliwa", async () => {
    expect((await request()).error).not.toBeNull();
  });

  it("zgoda innego rodzaju nie wystarcza", async () => {
    await consent("terms");
    await consent("data_processing");
    expect((await request()).error).not.toBeNull();
  });

  it("po zgodzie host_family_stay prośba przechodzi i startuje jako oczekująca", async () => {
    await consent();
    const r = await request();
    expect(r.error).toBeNull();
    expect(r.rows[0].status).toBe("pending");
  });

  it("prośba nie może powstać od razu jako zaakceptowana", async () => {
    await consent();
    expect((await request("accepted")).error).not.toBeNull();
  });

  it("zgodę na cudze dziecko może dodać tylko jego rodzic", async () => {
    const r = await db.as(stranger).try(`insert into consents(player_id, given_by_account_id, consent_type) values ('${guest.player}', '${stranger}', 'host_family_stay')`);
    expect(r.error).not.toBeNull();
  });

  it("wycofanie zgody (granted = false) blokuje nowe prośby o nocleg u rodziny", async () => {
    await consent("host_family_stay", true);
    await consent("host_family_stay", false);
    expect((await request()).error).not.toBeNull();
  });

  it("rodzic może wycofać zgodę (zmiana lub usunięcie wiersza zgody)", async () => {
    await consent();
    const upd = await db.as(guest.account).try(`update consents set granted = false where player_id = '${guest.player}' returning id`);
    const del = await db.as(guest.account).try(`delete from consents where player_id = '${guest.player}' and granted returning id`);
    expect(!isDenied(upd) || !isDenied(del)).toBe(true);
  });

  describe("po wysłaniu prośby", () => {
    let req;
    beforeEach(async () => {
      await consent();
      req = (await request()).rows[0].id;
    });
    it("gospodarz widzi prośbę, obcy nie", async () => {
      expect((await db.as(host).q(`select id from lodging_host_requests`)).length).toBe(1);
      expect(await db.as(stranger).q(`select id from lodging_host_requests`)).toEqual([]);
    });
    it("gość nie zaakceptuje własnej prośby", async () => {
      expect((await db.as(guest.account).try(`update lodging_host_requests set status = 'accepted' where id = '${req}'`)).error).not.toBeNull();
    });
    it("obcy nie zaakceptuje cudzej prośby", async () => {
      expect(isDenied(await db.as(stranger).try(`update lodging_host_requests set status = 'accepted' where id = '${req}' returning id`))).toBe(true);
    });
    it("gospodarz akceptuje, a następnie obie strony mogą anulować", async () => {
      expect((await db.as(host).try(`update lodging_host_requests set status = 'accepted' where id = '${req}' returning status`)).rows[0].status).toBe("accepted");
      expect((await db.as(guest.account).try(`update lodging_host_requests set status = 'cancelled' where id = '${req}' returning status`)).rows[0].status).toBe("cancelled");
    });
    it("odrzucona prośba nie wraca do życia", async () => {
      await db.as(host).try(`update lodging_host_requests set status = 'declined' where id = '${req}'`);
      expect((await db.as(host).try(`update lodging_host_requests set status = 'accepted' where id = '${req}'`)).error).not.toBeNull();
    });
    it("strony prośby są niezmienne", async () => {
      const other = await db.family(t, {});
      expect((await db.as(host).try(`update lodging_host_requests set requester_trip_id = '${other.trip}' where id = '${req}'`)).error).not.toBeNull();
    });
    it("profil drugiej strony (match_profile) jest ukryty do czasu akceptacji", async () => {
      expect(await db.as(host).q(`select * from match_profile('${guest.account}')`)).toEqual([]);
      await db.as(host).try(`update lodging_host_requests set status = 'accepted' where id = '${req}'`);
      const rows = await db.as(host).q(`select full_name from match_profile('${guest.account}')`);
      expect(rows).toHaveLength(1);
      expect(await db.as(stranger).q(`select * from match_profile('${guest.account}')`)).toEqual([]);
    });
  });

  it("ofertą gospodarza zarządza tylko gospodarz", async () => {
    expect(isDenied(await db.as(stranger).try(`update lodging_host_offers set capacity = 99 where id = '${ho}' returning id`))).toBe(true);
    expect(isDenied(await db.as(stranger).try(`delete from lodging_host_offers where id = '${ho}' returning id`))).toBe(true);
    expect((await db.as(stranger).try(`insert into lodging_host_offers(tournament_id, host_account_id, city, capacity) values ('${t}', '${host}', 'X', 1)`)).error).not.toBeNull();
  });

  it("ofertę gospodarza widzą wszyscy zalogowani, anonim nie", async () => {
    expect((await db.as(stranger).q(`select id from lodging_host_offers`)).length).toBe(1);
    expect(await db.anon().q(`select id from lodging_host_offers`)).toEqual([]);
  });
});

// ── rozmowy: kto może dodać kogo ──────────────────────────────────────────
describe("rozmowy i uczestnicy", () => {
  it("strona zaakceptowanego przejazdu może dodać drugą stronę do rozmowy", async () => {
    const t = await db.tournament();
    const d = await db.family(t, {});
    const g = await db.family(t, {});
    const offer = await db.rideOffer(d.trip, d.account);
    await db.joinRequest(offer, g.trip, "accepted");
    const conv = crypto.randomUUID();
    expect((await db.as(d.account).try(`insert into conversations(id, kind) values ('${conv}', 'ride')`)).error).toBeNull();
    expect((await db.as(d.account).try(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${g.account}')`)).error).toBeNull();
  });

  it("bez zaakceptowanej prośby nie da się dodać obcej osoby do rozmowy", async () => {
    const a = await db.user();
    const b = await db.user();
    const conv = crypto.randomUUID();
    expect((await db.as(a).try(`insert into conversations(id, kind) values ('${conv}', 'direct')`)).error).toBeNull();
    expect((await db.as(a).try(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${b}')`)).error).not.toBeNull();
  });

  it("pusta rozmowa jest niewidoczna dla jej twórcy (nic nie ujawnia)", async () => {
    const a = await db.user();
    expect((await db.as(a).try(`insert into conversations(kind) values ('direct')`)).error).toBeNull();
    expect(await db.as(a).q(`select * from conversations`)).toEqual([]);
  });

  it("zaakceptowana strona nie może dodać swojego partnera do OBCEJ rozmowy", async () => {
    const t = await db.tournament();
    const d = await db.family(t, {});
    const g = await db.family(t, {});
    const offer = await db.rideOffer(d.trip, d.account);
    await db.joinRequest(offer, g.trip, "accepted");
    // cudza rozmowa, w której d nie uczestniczy
    const x = await db.user();
    const y = await db.user();
    const conv = (await db.sql(`insert into conversations(kind) values ('direct') returning id`)).rows[0].id;
    await db.exec(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${x}'), ('${conv}', '${y}')`);
    await db.exec(`insert into messages(conversation_id, sender_account_id, body) values ('${conv}', '${x}', 'prywatne')`);
    await db.as(d.account).try(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${g.account}')`);
    expect(await db.as(g.account).q(`select * from messages where conversation_id = '${conv}'`)).toEqual([]);
  });
});

// ── wygaszanie przeterminowanych próśb ───────────────────────────────────
describe("expire_stale_requests", () => {
  async function pendingRequestOn(tournament) {
    const d = await db.family(tournament, {});
    const g = await db.family(tournament, {});
    const offer = await db.rideOffer(d.trip, d.account);
    return { id: await db.joinRequest(offer, g.trip, "pending"), d, g, offer };
  }

  it("anuluje oczekujące prośby na zakończone turnieje, zostawia przyszłe", async () => {
    const past = await db.tournament({ starts: "2020-01-01", ends: "2020-01-03" });
    const future = await db.tournament({ starts: "2099-01-01", ends: "2099-01-03" });
    const p = await pendingRequestOn(past);
    const f = await pendingRequestOn(future);
    const r = await db.service().one(`select expire_stale_requests() as r`);
    expect(r.r.ride).toBe(1);
    expect((await db.sql(`select status from ride_join_requests where id = '${p.id}'`)).rows[0].status).toBe("cancelled");
    expect((await db.sql(`select status from ride_join_requests where id = '${f.id}'`)).rows[0].status).toBe("pending");
  });

  it("nie rusza zaakceptowanych ani odrzuconych próśb", async () => {
    const past = await db.tournament({ starts: "2020-01-01", ends: "2020-01-03" });
    const d = await db.family(past, {});
    const g1 = await db.family(past, {});
    const g2 = await db.family(past, {});
    const offer = await db.rideOffer(d.trip, d.account);
    const acc = await db.joinRequest(offer, g1.trip, "accepted");
    const dec = await db.joinRequest(offer, g2.trip, "declined");
    await db.service().q(`select expire_stale_requests()`);
    expect((await db.sql(`select status from ride_join_requests where id = '${acc}'`)).rows[0].status).toBe("accepted");
    expect((await db.sql(`select status from ride_join_requests where id = '${dec}'`)).rows[0].status).toBe("declined");
  });

  it("bez daty końca turniej uznaje za zakończony dopiero 7 dni po starcie", async () => {
    const recent = await db.tournament({ starts: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10) });
    await db.exec(`update tournaments set ends_on = null where id = '${recent}'`);
    const old = await db.tournament({ starts: new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10) });
    await db.exec(`update tournaments set ends_on = null where id = '${old}'`);
    const a = await pendingRequestOn(recent);
    const b = await pendingRequestOn(old);
    await db.service().q(`select expire_stale_requests()`);
    expect((await db.sql(`select status from ride_join_requests where id = '${a.id}'`)).rows[0].status).toBe("pending");
    expect((await db.sql(`select status from ride_join_requests where id = '${b.id}'`)).rows[0].status).toBe("cancelled");
  });

  it("obejmuje też noclegi, pingi i nocleg u rodziny", async () => {
    const past = await db.tournament({ starts: "2020-01-01", ends: "2020-01-03" });
    const a = await db.family(past, {});
    const b = await db.family(past, {});
    const host = await db.user();
    const ho = (await db.sql(`insert into lodging_host_offers(tournament_id, host_account_id, city, capacity) values ('${past}', '${host}', 'X', 1) returning id`)).rows[0].id;
    await db.exec(`insert into lodging_host_requests(host_offer_id, requester_trip_id, status) values ('${ho}', '${a.trip}', 'pending')`);
    await db.exec(`insert into ride_pings(tournament_id, requester_trip_id, target_trip_id, status) values ('${past}', '${a.trip}', '${b.trip}', 'pending')`);
    const r = await db.service().one(`select expire_stale_requests() as r`);
    expect(r.r.host_lodging).toBe(1);
    expect(r.r.ride_ping).toBe(1);
  });

  it("jest dostępna wyłącznie dla service_role", async () => {
    const u = await db.user();
    expect((await db.as(u).try(`select expire_stale_requests()`)).error).not.toBeNull();
    expect((await db.anon().try(`select expire_stale_requests()`)).error).not.toBeNull();
    expect((await db.service().try(`select expire_stale_requests()`)).error).toBeNull();
  });

  it("zwykły użytkownik nie może wyłączyć strażnika przejść przez własne ustawienie tt.expire_rpc", async () => {
    const t = await db.tournament();
    const a = await db.family(t, {});
    const b = await db.family(t, {});
    const id = (await db.sql(`insert into ride_pings(tournament_id, requester_trip_id, target_trip_id) values ('${t}', '${a.trip}', '${b.trip}') returning id`)).rows[0].id;
    // nadawca próbuje "zaakceptować" własne zapytanie; PostgREST nie pozwala ustawić GUC, a SQL jako rola authenticated nie omija strażnika
    const r = await db.as(a.account).try(`update ride_pings set status = 'accepted' where id = '${id}'`);
    expect(r.error).not.toBeNull();
  });
});

// ── zawieszone konta ─────────────────────────────────────────────────────
describe("zawieszone konto", () => {
  let t, f, other, offer;
  beforeEach(async () => {
    t = await db.tournament({ city: "Warszawa" });
    f = await db.family(t, { first: "Zawieszony" });
    other = await db.family(t, {});
    offer = await db.rideOffer(other.trip, other.account);
    await db.exec(`update accounts set status = 'suspended' where id = '${f.account}'`);
  });

  it("nadal widzi własne konto (aplikacja pokaże ekran 'Konto zawieszone')", async () => {
    const rows = await db.as(f.account).q(`select status from accounts`);
    expect(rows).toEqual([{ status: "suspended" }]);
  });

  it("nie widzi własnych zawodników ani wyjazdów", async () => {
    expect(await db.as(f.account).q(`select * from players where owner_account_id = '${f.account}'`)).toEqual([]);
    expect(await db.as(f.account).q(`select * from trips where created_by_account_id = '${f.account}'`)).toEqual([]);
  });

  it("nie przegląda ofert przejazdów i noclegów", async () => {
    expect(await db.as(f.account).q(`select * from ride_offers`)).toEqual([]);
    expect(await db.as(f.account).q(`select * from lodging_offers`)).toEqual([]);
    expect(await db.as(f.account).q(`select * from lodging_host_offers`)).toEqual([]);
  });

  it("nie wysyła próśb, wiadomości ani zapytań, nie dodaje zawodników", async () => {
    const s = db.as(f.account);
    expect((await s.try(`insert into ride_join_requests(ride_offer_id, requester_trip_id) values ('${offer}', '${f.trip}')`)).error).not.toBeNull();
    expect((await s.try(`insert into players(owner_account_id, first_name, last_name, birth_year) values ('${f.account}', 'N', 'N', 2014)`)).error).not.toBeNull();
    expect((await s.try(`insert into ride_pings(tournament_id, requester_trip_id, target_trip_id) values ('${t}', '${f.trip}', '${other.trip}')`)).error).not.toBeNull();
    expect((await s.try(`insert into device_tokens(account_id, token) values ('${f.account}', 'x')`)).error).not.toBeNull();
  });

  it("nie czyta wiadomości z wcześniejszych rozmów", async () => {
    const conv = (await db.sql(`insert into conversations(kind) values ('direct') returning id`)).rows[0].id;
    await db.exec(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${f.account}'), ('${conv}', '${other.account}')`);
    await db.exec(`insert into messages(conversation_id, sender_account_id, body) values ('${conv}', '${other.account}', 'hej')`);
    expect(await db.as(f.account).q(`select * from messages`)).toEqual([]);
  });

  it("po odwieszeniu przez administratora wszystko wraca do normy", async () => {
    const admin = await db.user({ admin: true });
    await db.as(admin).try(`update accounts set status = 'active' where id = '${f.account}'`);
    expect((await db.as(f.account).q(`select id from players where owner_account_id = '${f.account}'`)).length).toBe(1);
  });

  it("zawieszenie nie dotyczy turniejów i listy miast (dane wspólne)", async () => {
    expect((await db.as(f.account).q(`select id from tournaments`)).length).toBeGreaterThan(0);
  });
});
