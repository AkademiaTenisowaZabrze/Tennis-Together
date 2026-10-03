// Migracja 0046: przejścia statusów próśb, otwieranie czatu po akceptacji i zgody rodziców.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { openDb, isDenied } from "../helpers/db.mjs";

let db;
beforeAll(async () => {
  db = await openDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

describe("dozwolone przejścia statusu prośby o przejazd", () => {
  let t, driver, parent, offer;
  beforeEach(async () => {
    t = await db.tournament({ city: "Warszawa" });
    driver = await db.family(t, { name: "Kierowca", first: "Dawid" });
    parent = await db.family(t, { name: "Rodzic pasażera", first: "Pola" });
    offer = await db.rideOffer(driver.trip, driver.account, { seats: 2 });
  });
  const setStatus = (who, id, status) => db.as(who).try(`update ride_join_requests set status = '${status}' where id = '${id}' returning status`);

  it("kierowca akceptuje oczekującą prośbę, a pasażer może potem zrezygnować", async () => {
    const req = await db.joinRequest(offer, parent.trip, "pending");
    expect((await setStatus(driver.account, req, "accepted")).rows[0]?.status).toBe("accepted");
    expect((await setStatus(parent.account, req, "cancelled")).rows[0]?.status).toBe("cancelled");
  });

  it("odrzucona prośba nie wraca do życia (declined -> accepted jest zabronione)", async () => {
    const req = await db.joinRequest(offer, parent.trip, "pending");
    await setStatus(driver.account, req, "declined");
    expect((await setStatus(driver.account, req, "accepted")).error).not.toBeNull();
    expect((await db.sql(`select status from ride_join_requests where id = '${req}'`)).rows[0].status).toBe("declined");
  });

  it("anulowana prośba nie wraca do życia (cancelled -> accepted jest zabronione)", async () => {
    const req = await db.joinRequest(offer, parent.trip, "accepted");
    await setStatus(parent.account, req, "cancelled");
    expect((await setStatus(driver.account, req, "accepted")).error).not.toBeNull();
  });

  it("zaakceptowanej prośby nie da się cofnąć do oczekującej", async () => {
    const req = await db.joinRequest(offer, parent.trip, "accepted");
    expect((await setStatus(driver.account, req, "pending")).error).not.toBeNull();
  });

  it("prośba o nocleg wspólny: start zawsze jako oczekująca i niezmienna oferta", async () => {
    const host = await db.family(t, { name: "Gospodarz noclegu" });
    const lo = (await db.sql(`insert into lodging_offers(trip_id, kind) values ('${host.trip}', 'shared_booking') returning id`)).rows[0].id;
    const lo2 = (await db.sql(`insert into lodging_offers(trip_id, kind) values ('${host.trip}', 'shared_booking') returning id`)).rows[0].id;
    const ins = await db.as(parent.account).try(
      `insert into lodging_join_requests(lodging_offer_id, requester_trip_id, status) values ('${lo}', '${parent.trip}', 'accepted') returning id, status`
    );
    expect(ins.rows[0].status).toBe("pending");
    const id = ins.rows[0].id;
    await db.as(host.account).try(`update lodging_join_requests set status = 'accepted' where id = '${id}'`);
    await db.as(parent.account).try(`update lodging_join_requests set lodging_offer_id = '${lo2}' where id = '${id}'`);
    expect((await db.sql(`select lodging_offer_id from lodging_join_requests where id = '${id}'`)).rows[0].lodging_offer_id).toBe(lo);
  });
});

describe("otwieranie czatu po akceptacji", () => {
  async function accepted() {
    const t = await db.tournament();
    const d = await db.family(t, {});
    const g = await db.family(t, {});
    const offer = await db.rideOffer(d.trip, d.account);
    await db.joinRequest(offer, g.trip, "accepted");
    return { d, g, t };
  }

  it("kierowca otwiera rozmowę tak, jak robi to aplikacja: jedno zapytanie z dwoma uczestnikami", async () => {
    const { d, g } = await accepted();
    const conv = crypto.randomUUID();
    expect((await db.as(d.account).try(`insert into conversations(id, kind) values ('${conv}', 'ride')`)).error).toBeNull();
    const r = await db.as(d.account).try(
      `insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${d.account}'), ('${conv}', '${g.account}')`
    );
    expect(r.error).toBeNull();
    expect((await db.as(g.account).q(`select account_id from conversation_participants where conversation_id = '${conv}'`)).length).toBe(2);
  });

  it("pasażer też może otworzyć rozmowę (oba wiersze naraz)", async () => {
    const { d, g } = await accepted();
    const conv = crypto.randomUUID();
    await db.as(g.account).try(`insert into conversations(id, kind) values ('${conv}', 'ride')`);
    const r = await db.as(g.account).try(
      `insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${g.account}'), ('${conv}', '${d.account}')`
    );
    expect(r.error).toBeNull();
  });

  it("osoba bez żadnego zaakceptowanego ustalenia nie dopisze się do rozmowy", async () => {
    const { d, g } = await accepted();
    const intruder = await db.user({ name: "Intruz" });
    const conv = (await db.sql(`insert into conversations(kind) values ('direct') returning id`)).rows[0].id;
    await db.exec(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${d.account}'), ('${conv}', '${g.account}')`);
    const r = await db.as(intruder).try(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${intruder}')`);
    expect(r.error).not.toBeNull();
  });

  it("strona zaakceptowanego ustalenia nie dopisze siebie do cudzej, niepustej rozmowy", async () => {
    const { d } = await accepted();
    const x = await db.user();
    const y = await db.user();
    const conv = (await db.sql(`insert into conversations(kind) values ('direct') returning id`)).rows[0].id;
    await db.exec(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${x}'), ('${conv}', '${y}')`);
    const r = await db.as(d.account).try(`insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${d.account}')`);
    expect(r.error).not.toBeNull();
    expect(await db.as(d.account).q(`select * from conversation_participants where conversation_id = '${conv}'`)).toEqual([]);
  });

  it("zaakceptowane zapytanie o podwiezienie również pozwala otworzyć czat dwoma wierszami", async () => {
    const t = await db.tournament();
    const a = await db.family(t, {});
    const b = await db.family(t, {});
    await db.exec(`insert into ride_pings(tournament_id, requester_trip_id, target_trip_id, status) values ('${t}', '${a.trip}', '${b.trip}', 'accepted')`);
    const conv = crypto.randomUUID();
    await db.as(b.account).try(`insert into conversations(id, kind) values ('${conv}', 'direct')`);
    const r = await db.as(b.account).try(
      `insert into conversation_participants(conversation_id, account_id) values ('${conv}', '${b.account}'), ('${conv}', '${a.account}')`
    );
    expect(r.error).toBeNull();
  });
});

describe("zgody rodziców", () => {
  async function setup() {
    const t = await db.tournament();
    const guest = await db.family(t, { name: "Rodzic gościa", first: "Gość" });
    const host = await db.user({ name: "Gospodarz" });
    const stranger = await db.user({ name: "Obcy" });
    return { t, guest, host, stranger };
  }

  it("rodzic dodaje zgodę dla własnego zawodnika, obcy nie dla cudzego", async () => {
    const { guest, stranger } = await setup();
    const own = await db.as(guest.account).try(
      `insert into consents(player_id, given_by_account_id, consent_type) values ('${guest.player}', '${guest.account}', 'terms')`
    );
    expect(own.error).toBeNull();
    const foreign = await db.as(stranger).try(
      `insert into consents(player_id, given_by_account_id, consent_type) values ('${guest.player}', '${stranger}', 'terms')`
    );
    expect(foreign.error).not.toBeNull();
  });

  it("rodzic może wycofać zgodę (granted = false), ale nie zmieni jej typu, zawodnika ani daty", async () => {
    const { guest } = await setup();
    const id = (await db.sql(
      `insert into consents(player_id, given_by_account_id, consent_type) values ('${guest.player}', '${guest.account}', 'terms') returning id`
    )).rows[0].id;
    const before = (await db.sql(`select created_at from consents where id = '${id}'`)).rows[0].created_at;
    const other = await db.family(await db.tournament(), { first: "Inny" });
    await db.as(guest.account).try(
      `update consents set granted = false, consent_type = 'data_processing', player_id = '${other.player}', created_at = '2001-01-01' where id = '${id}'`
    );
    const row = (await db.sql(`select granted, consent_type, player_id, created_at from consents where id = '${id}'`)).rows[0];
    expect(row).toMatchObject({ granted: false, consent_type: "terms", player_id: guest.player });
    expect(new Date(row.created_at).getTime()).toBe(new Date(before).getTime());
  });

  it("obcy nie wycofa cudzej zgody", async () => {
    const { guest, stranger } = await setup();
    const id = (await db.sql(
      `insert into consents(player_id, given_by_account_id, consent_type) values ('${guest.player}', '${guest.account}', 'terms') returning id`
    )).rows[0].id;
    expect(isDenied(await db.as(stranger).try(`update consents set granted = false where id = '${id}' returning id`))).toBe(true);
  });

  it("po wycofaniu zgody nowa prośba o nocleg u rodziny jest odrzucona, po ponownym udzieleniu przechodzi", async () => {
    const { t, guest, host } = await setup();
    const ho = (await db.sql(
      `insert into lodging_host_offers(tournament_id, host_account_id, city, capacity) values ('${t}', '${host}', 'Warszawa', 2) returning id`
    )).rows[0].id;
    const id = (await db.sql(
      `insert into consents(player_id, given_by_account_id, consent_type) values ('${guest.player}', '${guest.account}', 'host_family_stay') returning id`
    )).rows[0].id;
    const ask = () =>
      db.as(guest.account).try(`insert into lodging_host_requests(host_offer_id, requester_trip_id) values ('${ho}', '${guest.trip}') returning id`);
    await db.as(guest.account).try(`update consents set granted = false where id = '${id}'`);
    expect((await ask()).error).not.toBeNull();
    await db.as(guest.account).try(`update consents set granted = true where id = '${id}'`);
    expect((await ask()).error).toBeNull();
  });
});
