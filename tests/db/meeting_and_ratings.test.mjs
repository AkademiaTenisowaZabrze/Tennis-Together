// Potwierdzanie spotkania kodem, oceny po spotkaniu i pineska miejsca spotkania.
// Te same reguły powinny działać dla przejazdu, noclegu wspólnego i noclegu u rodziny.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { openDb, isDenied } from "../helpers/db.mjs";

let db;
beforeAll(async () => {
  db = await openDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

const TABLE = { ride: "ride_join_requests", lodging: "lodging_join_requests", host_lodging: "lodging_host_requests" };

// Tworzy zaakceptowane ustalenie danego rodzaju i zwraca strony A (właściciel oferty) i B (proszący).
async function accepted(kind, status = "accepted") {
  const t = await db.tournament({ city: "Warszawa" });
  const guest = await db.family(t, { name: "Proszący", first: "Gość" });
  const outsider = await db.user({ name: "Postronny" });
  let owner, requestId;
  if (kind === "ride") {
    const driver = await db.family(t, { name: "Właściciel", first: "Kierowca" });
    const offer = await db.rideOffer(driver.trip, driver.account);
    requestId = await db.joinRequest(offer, guest.trip, status);
    owner = driver.account;
  } else if (kind === "lodging") {
    const host = await db.family(t, { name: "Właściciel", first: "Gospodarz" });
    const lo = (await db.sql(`insert into lodging_offers(trip_id, kind) values ('${host.trip}', 'shared_booking') returning id`)).rows[0].id;
    requestId = (await db.sql(`insert into lodging_join_requests(lodging_offer_id, requester_trip_id, status) values ('${lo}', '${guest.trip}', '${status}') returning id`)).rows[0].id;
    owner = host.account;
  } else {
    owner = await db.user({ name: "Gospodarz rodzinny" });
    const ho = (await db.sql(`insert into lodging_host_offers(tournament_id, host_account_id, city, capacity) values ('${t}', '${owner}', 'Warszawa', 2) returning id`)).rows[0].id;
    requestId = (await db.sql(`insert into lodging_host_requests(host_offer_id, requester_trip_id, status) values ('${ho}', '${guest.trip}', '${status}') returning id`)).rows[0].id;
  }
  return { kind, table: TABLE[kind], id: requestId, A: owner, B: guest.account, outsider, t };
}

const KINDS = ["ride", "lodging", "host_lodging"];
const confirm = (who, c, code) => db.as(who).one(`select confirm_meeting('${c.id}', '${c.kind}', ${db.lit(code)}) as r`).then((x) => x.r);
const setCode = (who, c, code) => db.as(who).try(`update ${c.table} set meeting_code = '${code}' where id = '${c.id}'`);

for (const kind of KINDS) {
  describe(`potwierdzanie spotkania kodem (${kind})`, () => {
    it("jedna strona ustawia kod, druga wpisuje go i spotkanie zostaje potwierdzone", async () => {
      const c = await accepted(kind);
      expect((await setCode(c.A, c, "ABC123")).error).toBeNull();
      expect((await confirm(c.B, c, "ABC123")).result).toBe("ok");
      const row = (await db.sql(`select meeting_confirmed_at, meeting_confirmed_by from ${c.table} where id = '${c.id}'`)).rows[0];
      expect(row.meeting_confirmed_at).not.toBeNull();
      expect(row.meeting_confirmed_by).toBe(c.B);
    });

    it("kod jest porównywany bez względu na wielkość liter i spacje", async () => {
      const c = await accepted(kind);
      await setCode(c.A, c, "ABC123");
      expect((await confirm(c.B, c, "  abc123 ")).result).toBe("ok");
    });

    it("autor kodu nie może potwierdzić spotkania własnym kodem", async () => {
      const c = await accepted(kind);
      await setCode(c.A, c, "ABC123");
      expect((await confirm(c.A, c, "ABC123")).result).toBe("own_code");
    });

    it("bez ustawionego kodu potwierdzenie nie jest możliwe", async () => {
      const c = await accepted(kind);
      expect((await confirm(c.B, c, "ABC123")).result).toBe("no_code");
    });

    it("błędny kod zwiększa licznik prób i nie potwierdza", async () => {
      const c = await accepted(kind);
      await setCode(c.A, c, "ABC123");
      const r = await confirm(c.B, c, "ZZZZZZ");
      expect(r.result).toBe("mismatch");
      expect(r.attempts_left).toBe(4);
      expect((await db.sql(`select meeting_confirmed_at from ${c.table} where id = '${c.id}'`)).rows[0].meeting_confirmed_at).toBeNull();
    });

    it("po 5 błędnych próbach kod się blokuje, nawet poprawny nie działa", async () => {
      const c = await accepted(kind);
      await setCode(c.A, c, "ABC123");
      for (let i = 0; i < 5; i++) expect((await confirm(c.B, c, `BAD${i}`)).result).toBe("mismatch");
      expect((await confirm(c.B, c, "ABC123")).result).toBe("locked");
    });

    it("po zablokowaniu nowy kod zeruje licznik prób", async () => {
      const c = await accepted(kind);
      await setCode(c.A, c, "ABC123");
      for (let i = 0; i < 5; i++) await confirm(c.B, c, `BAD${i}`);
      await setCode(c.A, c, "NEW456");
      expect((await confirm(c.B, c, "NEW456")).result).toBe("ok");
    });

    it("osoba postronna nie może potwierdzić ani zgadywać kodu", async () => {
      const c = await accepted(kind);
      await setCode(c.A, c, "ABC123");
      expect((await confirm(c.outsider, c, "ABC123")).result).toBe("forbidden");
    });

    it("anonim nie może potwierdzić spotkania", async () => {
      const c = await accepted(kind);
      await setCode(c.A, c, "ABC123");
      const r = await db.anon().try(`select confirm_meeting('${c.id}', '${kind}', 'ABC123') as r`);
      expect(r.error !== null || r.rows[0]?.r?.result === "forbidden").toBe(true);
    });

    it("nieaktywne (nie zaakceptowane) ustalenie nie może być potwierdzone", async () => {
      const c = await accepted(kind, "pending");
      await db.exec(`update ${c.table} set meeting_code = 'ABC123', meeting_code_by = '${c.A}' where id = '${c.id}'`);
      expect((await confirm(c.B, c, "ABC123")).result).toBe("forbidden");
    });

    it("po potwierdzeniu ponowne potwierdzenie zwraca 'already'", async () => {
      const c = await accepted(kind);
      await setCode(c.A, c, "ABC123");
      await confirm(c.B, c, "ABC123");
      expect((await confirm(c.B, c, "ABC123")).result).toBe("already");
    });

    it("potwierdzony kod nie może zostać zmieniony", async () => {
      const c = await accepted(kind);
      await setCode(c.A, c, "ABC123");
      await confirm(c.B, c, "ABC123");
      expect((await setCode(c.A, c, "HACK99")).error).not.toBeNull();
    });

    it("strona nie może obejść kodu, ustawiając meeting_confirmed_at ręcznie", async () => {
      const c = await accepted(kind);
      const r = await db.as(c.B).try(`update ${c.table} set meeting_confirmed_at = now(), meeting_confirmed_by = '${c.B}' where id = '${c.id}'`);
      expect(r.error).not.toBeNull();
      expect((await db.sql(`select meeting_confirmed_at from ${c.table} where id = '${c.id}'`)).rows[0].meeting_confirmed_at).toBeNull();
    });

    it("strona nie może wyzerować licznika prób bezpośrednim update", async () => {
      const c = await accepted(kind);
      await setCode(c.A, c, "ABC123");
      for (let i = 0; i < 5; i++) await confirm(c.B, c, `BAD${i}`);
      await db.as(c.B).try(`update ${c.table} set meeting_attempts = 0 where id = '${c.id}'`);
      expect((await db.sql(`select meeting_attempts from ${c.table} where id = '${c.id}'`)).rows[0].meeting_attempts).toBe(5);
    });

    it("strona nie może podszyć się pod autora kodu (meeting_code_by)", async () => {
      const c = await accepted(kind);
      await setCode(c.A, c, "ABC123");
      await db.as(c.B).try(`update ${c.table} set meeting_code_by = '${c.B}' where id = '${c.id}'`);
      expect((await db.sql(`select meeting_code_by from ${c.table} where id = '${c.id}'`)).rows[0].meeting_code_by).toBe(c.A);
    });
  });
}

describe("oceny po spotkaniu", () => {
  const rate = (who, c, rated, stars = 5, kindOverride) =>
    db.as(who).try(
      `insert into ratings(join_request_id, join_request_kind, rater_account_id, rated_account_id, stars, comment)
       values ('${c.id}', '${kindOverride ?? c.kind}', '${who}', '${rated}', ${stars}, 'komentarz')`
    );
  async function confirmed(kind) {
    const c = await accepted(kind);
    await setCode(c.A, c, "ABC123");
    await confirm(c.B, c, "ABC123");
    return c;
  }

  for (const kind of KINDS) {
    it(`(${kind}) obie strony mogą wystawić sobie oceny po potwierdzonym spotkaniu`, async () => {
      const c = await confirmed(kind);
      expect((await rate(c.A, c, c.B)).error).toBeNull();
      expect((await rate(c.B, c, c.A, 4)).error).toBeNull();
    });

    it(`(${kind}) bez potwierdzonego spotkania ocena jest niemożliwa`, async () => {
      const c = await accepted(kind);
      expect((await rate(c.A, c, c.B)).error).not.toBeNull();
    });

    it(`(${kind}) osoba postronna nie oceni cudzego spotkania`, async () => {
      const c = await confirmed(kind);
      expect((await rate(c.outsider, c, c.A)).error).not.toBeNull();
    });
  }

  it("nie można oceniać samego siebie", async () => {
    const c = await confirmed("ride");
    expect((await rate(c.A, c, c.A)).error).not.toBeNull();
  });

  // Druga linia obrony: nawet gdy obie strony ustalenia to to samo konto (układ, którego
  // aplikacja nie tworzy, ale baza nie może na tym polegać), samoocena jest odrzucana.
  // Test wykryty dzięki mutacji "można ocenić samego siebie" (tests/mutation).
  it("samoocena jest odrzucana także wtedy, gdy obie strony spotkania to to samo konto", async () => {
    const t = await db.tournament({ city: "Warszawa" });
    const me = await db.family(t, { name: "Sam", first: "Zawodnik" });
    const other = await db.family(t, { name: "Inny", first: "Gość" });
    const offer = await db.rideOffer(me.trip, me.account);
    const reqId = await db.joinRequest(offer, other.trip, "accepted");
    await db.sql(`update trips set created_by_account_id = '${me.account}' where id = '${other.trip}'`);
    // strażnik z 0026 (trigger) blokuje ustawienie potwierdzenia poza kodem, więc na czas przygotowania danych go wyłączamy
    await db.sql(`alter table ride_join_requests disable trigger user`);
    await db.sql(`update ride_join_requests set meeting_confirmed_at = now(), meeting_confirmed_by = '${me.account}' where id = '${reqId}'`);
    await db.sql(`alter table ride_join_requests enable trigger user`);
    expect((await db.as(me.account).one(`select can_rate('${reqId}', 'ride', '${me.account}') as ok`)).ok).toBe(true);
    const r = await db.as(me.account).try(
      `insert into ratings(join_request_id, join_request_kind, rater_account_id, rated_account_id, stars) values ('${reqId}', 'ride', '${me.account}', '${me.account}', 5)`
    );
    expect(r.error).not.toBeNull();
  });

  it("nie można ocenić dwa razy tego samego spotkania", async () => {
    const c = await confirmed("ride");
    expect((await rate(c.A, c, c.B)).error).toBeNull();
    expect((await rate(c.A, c, c.B, 1)).error).not.toBeNull();
  });

  it("liczba gwiazdek musi być od 1 do 5", async () => {
    const c = await confirmed("ride");
    for (const bad of [0, 6, -3]) expect((await rate(c.A, c, c.B, bad)).error, String(bad)).not.toBeNull();
  });

  it("nie można wystawić oceny w imieniu drugiej osoby", async () => {
    const c = await confirmed("ride");
    const r = await db.as(c.A).try(
      `insert into ratings(join_request_id, join_request_kind, rater_account_id, rated_account_id, stars) values ('${c.id}', 'ride', '${c.B}', '${c.A}', 1)`
    );
    expect(r.error).not.toBeNull();
  });

  it("nie można podać złego rodzaju spotkania, żeby obejść weryfikację", async () => {
    const c = await confirmed("ride");
    expect((await rate(c.A, c, c.B, 5, "lodging")).error).not.toBeNull();
  });

  it("zawieszone konto nie wystawia ocen", async () => {
    const c = await confirmed("ride");
    await db.exec(`update accounts set status = 'suspended' where id = '${c.A}'`);
    expect((await rate(c.A, c, c.B)).error).not.toBeNull();
  });

  it("oceniony widzi ocenę, postronny nie widzi jej treści", async () => {
    const c = await confirmed("ride");
    await rate(c.A, c, c.B, 3);
    expect((await db.as(c.B).q(`select stars from ratings`)).length).toBe(1);
    expect(await db.as(c.outsider).q(`select * from ratings`)).toEqual([]);
  });

  it("oceny nie da się zmienić ani usunąć (brak polityk update/delete)", async () => {
    const c = await confirmed("ride");
    await rate(c.A, c, c.B, 3);
    expect(isDenied(await db.as(c.A).try(`update ratings set stars = 5 returning id`))).toBe(true);
    expect(isDenied(await db.as(c.A).try(`delete from ratings returning id`))).toBe(true);
  });

  it("średnia ocena jest publiczna, ale bez treści komentarzy", async () => {
    const c = await confirmed("ride");
    await rate(c.A, c, c.B, 4);
    const r = await db.as(c.outsider).try(`select * from account_rating('${c.B}')`);
    expect(r.error).toBeNull();
    expect(JSON.stringify(r.rows)).not.toContain("komentarz");
  });
});

describe("pineska miejsca spotkania (set_meeting_point)", () => {
  const set = (who, c, lat, lng, place) =>
    db.as(who).one(`select set_meeting_point('${c.kind}', '${c.id}', ${lat}, ${lng}, ${db.lit(place)}) as r`).then((x) => x.r);

  it("strona zaakceptowanego przejazdu ustawia pineskę z opisem", async () => {
    const c = await accepted("ride");
    expect((await set(c.B, c, 50.3, 18.7, "parking pod Biedronką")).result).toBe("ok");
    const row = (await db.sql(`select meeting_lat, meeting_place, meeting_point_set_by from ride_join_requests where id = '${c.id}'`)).rows[0];
    expect(row.meeting_lat).toBeCloseTo(50.3);
    expect(row.meeting_place).toBe("parking pod Biedronką");
    expect(row.meeting_point_set_by).toBe(c.B);
  });

  it("druga strona może pineskę zmienić, a autor ostatniej zmiany jest zapisany", async () => {
    const c = await accepted("ride");
    await set(c.B, c, 50.3, 18.7, "A");
    await set(c.A, c, 50.4, 18.8, "B");
    expect((await db.sql(`select meeting_point_set_by from ride_join_requests where id = '${c.id}'`)).rows[0].meeting_point_set_by).toBe(c.A);
  });

  it("pustą pineską (null) można ją wyczyścić", async () => {
    const c = await accepted("ride");
    await set(c.B, c, 50.3, 18.7, "x");
    const r = await db.as(c.B).one(`select set_meeting_point('ride', '${c.id}', null, null, null) as r`);
    expect(r.r.result).toBe("ok");
    expect((await db.sql(`select meeting_lat, meeting_place from ride_join_requests where id = '${c.id}'`)).rows[0].meeting_lat).toBeNull();
  });

  it("osoba postronna nie ustawi pineski", async () => {
    const c = await accepted("ride");
    expect((await set(c.outsider, c, 50.3, 18.7, "x")).result).toBe("forbidden");
  });

  it("przy oczekującej prośbie pineska jest niedozwolona", async () => {
    const c = await accepted("ride", "pending");
    expect((await set(c.B, c, 50.3, 18.7, "x")).result).toBe("forbidden");
  });

  it("anonim nie ustawi pineski", async () => {
    const c = await accepted("ride");
    const r = await db.anon().try(`select set_meeting_point('ride', '${c.id}', 50.3, 18.7, 'x') as r`);
    expect(r.error !== null || r.rows[0]?.r?.result === "forbidden").toBe(true);
  });

  it("odrzuca współrzędne spoza zakresu lub niepełne", async () => {
    const c = await accepted("ride");
    for (const [lat, lng] of [[91, 18], [-91, 18], [50, 181], [50, -181], [50, "null"], ["null", 18]]) {
      expect((await set(c.B, c, lat, lng, "x")).result, `${lat},${lng}`).toBe("invalid");
    }
  });

  it("nieznany rodzaj ustalenia jest odrzucony", async () => {
    const c = await accepted("ride");
    const r = await db.as(c.B).one(`select set_meeting_point('nocleg', '${c.id}', 50, 18, 'x') as r`);
    expect(r.r.result).toBe("forbidden");
  });

  it("opis miejsca jest skracany do 120 znaków, a pusty zapisany jako brak", async () => {
    const c = await accepted("ride");
    await set(c.B, c, 50.3, 18.7, "x".repeat(300));
    expect((await db.sql(`select length(meeting_place) l from ride_join_requests where id = '${c.id}'`)).rows[0].l).toBe(120);
    await set(c.B, c, 50.3, 18.7, "   ");
    expect((await db.sql(`select meeting_place from ride_join_requests where id = '${c.id}'`)).rows[0].meeting_place).toBeNull();
  });

  it("zapytanie o podwiezienie (ping) też obsługuje pineskę, tylko dla stron", async () => {
    const t = await db.tournament({ city: "Warszawa" });
    const a = await db.family(t, { first: "A" });
    const b = await db.family(t, { first: "B" });
    const outsider = await db.user();
    const ping = (await db.sql(`insert into ride_pings(tournament_id, requester_trip_id, target_trip_id, status) values ('${t}', '${a.trip}', '${b.trip}', 'accepted') returning id`)).rows[0].id;
    const ok = await db.as(a.account).one(`select set_meeting_point('ride_ping', '${ping}', 50, 18, 'dworzec') as r`);
    expect(ok.r.result).toBe("ok");
    const no = await db.as(outsider).one(`select set_meeting_point('ride_ping', '${ping}', 50, 18, 'x') as r`);
    expect(no.r.result).toBe("forbidden");
  });
});
