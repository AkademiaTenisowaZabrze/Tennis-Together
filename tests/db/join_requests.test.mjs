// Cykl życia prośby o miejsce w aucie: kto może ją utworzyć, zaakceptować,
// anulować, oraz czy da się obejść akceptację kierowcy.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { openDb, isDenied } from "../helpers/db.mjs";

let db, t, driver, parent, other, offer;
beforeAll(async () => {
  db = await openDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  t = await db.tournament({ city: "Warszawa" });
  driver = await db.family(t, { name: "Kierowca", first: "Dawid" });
  parent = await db.family(t, { name: "Rodzic pasażera", first: "Pola" });
  other = await db.family(t, { name: "Inny kierowca", first: "Ola" });
  offer = await db.rideOffer(driver.trip, driver.account, { seats: 2 });
});

const send = (who, offerId, tripId) =>
  db.as(who).try(`insert into ride_join_requests(ride_offer_id, requester_trip_id) values ('${offerId}', '${tripId}') returning id, status`);

describe("tworzenie prośby", () => {
  it("rodzic może poprosić o miejsce z własnego wyjazdu", async () => {
    const r = await send(parent.account, offer, parent.trip);
    expect(r.error).toBeNull();
    expect(r.rows[0].status).toBe("pending");
  });

  it("rodzic nie może wysłać prośby w imieniu cudzego wyjazdu", async () => {
    const r = await send(parent.account, offer, other.trip);
    expect(r.error).not.toBeNull();
  });

  it("nowa prośba zawsze zaczyna jako oczekująca, nawet gdy pasażer poda status 'accepted'", async () => {
    // pasażer może dziś wstawić prośbę od razu zaakceptowaną: obejście zgody kierowcy
    const r = await db.as(parent.account).try(
      `insert into ride_join_requests(ride_offer_id, requester_trip_id, status) values ('${offer}', '${parent.trip}', 'accepted') returning status`
    );
    expect(r.error !== null || r.rows[0].status === "pending").toBe(true);
  });

  it("nie można wysłać dwóch identycznych próśb o to samo miejsce", async () => {
    expect((await send(parent.account, offer, parent.trip)).error).toBeNull();
    expect((await send(parent.account, offer, parent.trip)).error).not.toBeNull();
  });

  it("zawieszone konto nie wyśle prośby", async () => {
    await db.exec(`update accounts set status = 'suspended' where id = '${parent.account}'`);
    expect((await send(parent.account, offer, parent.trip)).error).not.toBeNull();
  });
});

describe("odpowiedź kierowcy", () => {
  let req;
  beforeEach(async () => {
    req = await db.joinRequest(offer, parent.trip, "pending");
  });

  it("kierowca akceptuje prośbę", async () => {
    const r = await db.as(driver.account).try(`update ride_join_requests set status = 'accepted' where id = '${req}' returning status`);
    expect(r.rows[0]?.status).toBe("accepted");
  });

  it("kierowca odrzuca prośbę", async () => {
    const r = await db.as(driver.account).try(`update ride_join_requests set status = 'declined' where id = '${req}' returning status`);
    expect(r.rows[0]?.status).toBe("declined");
  });

  it("pasażer NIE może sam zaakceptować swojej prośby", async () => {
    const r = await db.as(parent.account).try(`update ride_join_requests set status = 'accepted' where id = '${req}' returning status`);
    expect(isDenied(r)).toBe(true);
    expect((await db.sql(`select status from ride_join_requests where id = '${req}'`)).rows[0].status).toBe("pending");
  });

  it("obcy kierowca nie może odpowiadać na cudzą prośbę", async () => {
    const r = await db.as(other.account).try(`update ride_join_requests set status = 'accepted' where id = '${req}' returning status`);
    expect(isDenied(r)).toBe(true);
  });

  it("prośba nieoczekująca nie wraca do 'pending' przez pasażera", async () => {
    await db.exec(`update ride_join_requests set status = 'declined' where id = '${req}'`);
    const r = await db.as(parent.account).try(`update ride_join_requests set status = 'pending' where id = '${req}' returning status`);
    expect(isDenied(r)).toBe(true);
  });

  it("pasażer może wycofać oczekującą prośbę (usunięcie)", async () => {
    const r = await db.as(parent.account).try(`delete from ride_join_requests where id = '${req}' returning id`);
    expect(r.rows.length).toBe(1);
  });

  it("obcy nie może usunąć cudzej prośby", async () => {
    expect(isDenied(await db.as(other.account).try(`delete from ride_join_requests where id = '${req}' returning id`))).toBe(true);
  });
});

describe("rezygnacja po akceptacji", () => {
  let req;
  beforeEach(async () => {
    req = await db.joinRequest(offer, parent.trip, "accepted");
  });

  it("pasażer może zrezygnować z zaakceptowanego przejazdu", async () => {
    const r = await db.as(parent.account).try(`update ride_join_requests set status = 'cancelled' where id = '${req}' returning status`);
    expect(r.rows[0]?.status).toBe("cancelled");
  });

  it("kierowca może zrezygnować z zaakceptowanego przejazdu", async () => {
    const r = await db.as(driver.account).try(`update ride_join_requests set status = 'cancelled' where id = '${req}' returning status`);
    expect(r.rows[0]?.status).toBe("cancelled");
  });

  it("anulowanej prośby pasażer nie reaktywuje", async () => {
    await db.exec(`update ride_join_requests set status = 'cancelled' where id = '${req}'`);
    const r = await db.as(parent.account).try(`update ride_join_requests set status = 'accepted' where id = '${req}' returning status`);
    expect(isDenied(r)).toBe(true);
  });

  it("pasażer nie ustawi innego statusu niż 'cancelled' (np. 'declined')", async () => {
    const r = await db.as(parent.account).try(`update ride_join_requests set status = 'declined' where id = '${req}' returning status`);
    expect(isDenied(r)).toBe(true);
  });

  it("obcy nie anuluje cudzego przejazdu", async () => {
    expect(isDenied(await db.as(other.account).try(`update ride_join_requests set status = 'cancelled' where id = '${req}' returning id`))).toBe(true);
  });
});

describe("obejście akceptacji kierowcy (zamknięte w 0046, dawniej F9)", () => {
  it("pasażer z zaakceptowaną prośbą nie może przepiąć jej na ofertę innego kierowcy", async () => {
    const req = await db.joinRequest(offer, parent.trip, "accepted");
    const otherOffer = await db.rideOffer(other.trip, other.account);
    await db.as(parent.account).try(`update ride_join_requests set ride_offer_id = '${otherOffer}' where id = '${req}'`);
    const stored = (await db.sql(`select ride_offer_id from ride_join_requests where id = '${req}'`)).rows[0].ride_offer_id;
    expect(stored).toBe(offer);
  });

  it("kierowca nie może przepiąć prośby na wyjazd dowolnej obcej rodziny", async () => {
    const req = await db.joinRequest(offer, parent.trip, "pending");
    await db.as(driver.account).try(`update ride_join_requests set requester_trip_id = '${other.trip}', status = 'accepted' where id = '${req}'`);
    const stored = (await db.sql(`select requester_trip_id from ride_join_requests where id = '${req}'`)).rows[0].requester_trip_id;
    expect(stored).toBe(parent.trip);
  });

  it("kierowca nie może przepiąć prośby na ofertę innego kierowcy", async () => {
    const req = await db.joinRequest(offer, parent.trip, "pending");
    const otherOffer = await db.rideOffer(other.trip, other.account);
    // druga oferta nie należy do kierowcy, więc with check powinien to zablokować
    await db.as(driver.account).try(`update ride_join_requests set ride_offer_id = '${otherOffer}' where id = '${req}'`);
    const stored = (await db.sql(`select ride_offer_id from ride_join_requests where id = '${req}'`)).rows[0].ride_offer_id;
    expect(stored).toBe(offer);
  });
});

describe("ceny w prośbach", () => {
  it("prośba do oferty bez zwrotu kosztów nie ma uzgodnionej kwoty", async () => {
    const r = await db.as(parent.account).try(`insert into ride_join_requests(ride_offer_id, requester_trip_id) values ('${offer}', '${parent.trip}') returning agreed_cost_pln`);
    expect(r.rows[0].agreed_cost_pln).toBeNull();
  });

  it("prośba do oferty ze zwrotem kosztów zapamiętuje kwotę z oferty", async () => {
    const paid = await db.rideOffer(other.trip, other.account, { refund: true });
    const amount = (await db.sql(`select cost_per_person_pln from ride_offers where id = '${paid}'`)).rows[0].cost_per_person_pln;
    expect(amount).toBeGreaterThan(0);
    const r = await db.as(parent.account).try(`insert into ride_join_requests(ride_offer_id, requester_trip_id) values ('${paid}', '${parent.trip}') returning agreed_cost_pln`);
    expect(r.rows[0].agreed_cost_pln).toBe(amount);
  });

  it("pasażer nie może sam wpisać kwoty (agreed_cost_pln jest ustawiane przez bazę)", async () => {
    const paid = await db.rideOffer(other.trip, other.account, { refund: true });
    const amount = (await db.sql(`select cost_per_person_pln from ride_offers where id = '${paid}'`)).rows[0].cost_per_person_pln;
    const r = await db.as(parent.account).try(
      `insert into ride_join_requests(ride_offer_id, requester_trip_id, agreed_cost_pln) values ('${paid}', '${parent.trip}', 1) returning agreed_cost_pln`
    );
    expect(r.rows[0].agreed_cost_pln).toBe(amount);
  });

  it("kwota uzgodniona w prośbie nie zmienia się po jej akceptacji ani przez kierowcę", async () => {
    const paid = await db.rideOffer(other.trip, other.account, { refund: true });
    const req = (await db.as(parent.account).try(`insert into ride_join_requests(ride_offer_id, requester_trip_id) values ('${paid}', '${parent.trip}') returning id, agreed_cost_pln`)).rows[0];
    await db.as(other.account).try(`update ride_join_requests set status = 'accepted', agreed_cost_pln = 1 where id = '${req.id}'`);
    const stored = (await db.sql(`select agreed_cost_pln, status from ride_join_requests where id = '${req.id}'`)).rows[0];
    expect(stored.status).toBe("accepted");
    expect(stored.agreed_cost_pln).toBe(req.agreed_cost_pln);
  });

  it("zmiana ceny paliwa przez administratora nie zmienia kwoty już wysłanej prośby", async () => {
    const paid = await db.rideOffer(other.trip, other.account, { refund: true });
    const req = (await db.as(parent.account).try(`insert into ride_join_requests(ride_offer_id, requester_trip_id) values ('${paid}', '${parent.trip}') returning id, agreed_cost_pln`)).rows[0];
    await db.exec(`update ride_cost_settings set fuel_price_pln = 14`);
    const stored = (await db.sql(`select agreed_cost_pln from ride_join_requests where id = '${req.id}'`)).rows[0].agreed_cost_pln;
    expect(stored).toBe(req.agreed_cost_pln);
  });
});
