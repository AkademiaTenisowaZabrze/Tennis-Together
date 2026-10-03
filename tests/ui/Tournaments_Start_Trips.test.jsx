// Ekrany: Turnieje (filtry, zgłaszanie wyjazdu), Start (baner synchronizacji, najbliższy wyjazd), Moje wyjazdy (kalendarz).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/supabase.js", async () => await import("../helpers/fakeSupabase.js"));
import { fake, ME } from "../helpers/fakeSupabase.js";
import TournamentsPage from "../../src/pages/TournamentsPage.jsx";
import StartPage from "../../src/pages/StartPage.jsx";
import TripsPage from "../../src/pages/TripsPage.jsx";
import { renderWithApp } from "../helpers/render.jsx";

beforeEach(() => {
  fake.reset();
  sessionStorage.clear();
});
afterEach(() => cleanup());

const nowIso = () => new Date().toISOString();

describe("Turnieje", () => {
  async function open() {
    const user = userEvent.setup();
    renderWithApp(<TournamentsPage />);
    await screen.findByText("Turniej U12 Warszawa");
    return user;
  }
  const names = () =>
    [...document.querySelectorAll(".glass-card")]
      .map((c) => [...c.querySelectorAll("*")].find((e) => e.children.length === 0 && /^Turniej U1\d/.test(e.textContent))?.textContent)
      .filter(Boolean);

  it("pokazuje wszystkie turnieje z kalendarza", async () => {
    await open();
    expect(names()).toEqual(["Turniej U12 Warszawa", "Turniej U12 Gdańsk", "Turniej U14 Sopot"]);
  });

  it("filtr kategorii zawęża listę, a 'Wszystkie kategorie' ją przywraca", async () => {
    const user = await open();
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "U14");
    expect(names()).toEqual(["Turniej U14 Sopot"]);
    await user.selectOptions(select, "U12");
    expect(names()).toEqual(["Turniej U12 Warszawa", "Turniej U12 Gdańsk"]);
    await user.selectOptions(select, "all");
    expect(names()).toHaveLength(3);
  });

  it("lista kategorii w filtrze pochodzi z danych kalendarza", async () => {
    await open();
    const opts = within(screen.getByRole("combobox")).getAllByRole("option").map((o) => o.textContent);
    expect(opts).toEqual(["Wszystkie kategorie", "U12", "U14"]);
  });

  it("filtr źródła pokazuje tylko turnieje danego źródła", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Tennis Europe" }));
    expect(names()).toEqual(["Turniej U14 Sopot"]);
    await user.click(screen.getByRole("button", { name: "PZT" }));
    expect(names()).toEqual(["Turniej U12 Warszawa", "Turniej U12 Gdańsk"]);
    await user.click(screen.getByRole("button", { name: "Wszystkie" }));
    expect(names()).toHaveLength(3);
  });

  it("filtr bez wyników pokazuje komunikat", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "ITF" }));
    expect(await screen.findByText(/Brak turniejów dla tego filtra/)).toBeInTheDocument();
  });

  it("nie ma już wyszukiwarki turnieju po zawodniku", async () => {
    await open();
    expect(screen.queryByText(/Znajdź turniej po zawodniku/i)).not.toBeInTheDocument();
  });

  it("turniej, na który jedzie zawodnik, jest oznaczony i prowadzi do Moich wyjazdów", async () => {
    await open();
    const c = screen.getByText("Turniej U12 Warszawa").closest(".glass-card");
    expect(within(c).getByText(/Jedziesz: Kuba/)).toBeInTheDocument();
    expect(within(c).getByRole("link", { name: "Zobacz w Moich wyjazdach" })).toHaveAttribute("href", "/moje-wyjazdy");
  });

  it("zgłoszenie wyjazdu: wymaga miasta i zapisuje wyjazd wybranego zawodnika", async () => {
    const user = await open();
    const c = screen.getByText("Turniej U14 Sopot").closest(".glass-card");
    await user.click(within(c).getByRole("button", { name: "Jadę na ten turniej" }));
    await user.click(within(c).getByRole("button", { name: "Potwierdź wyjazd" }));
    expect(await within(c).findByText(/Podaj miasto wyjazdu/)).toBeInTheDocument();
    expect(fake.log.filter((l) => l.table === "trips" && l.op === "insert")).toHaveLength(0);

    await user.type(within(c).getByPlaceholderText("np. Katowice"), "  Zabrze ");
    await user.click(within(c).getByRole("button", { name: "Potwierdź wyjazd" }));
    await waitFor(() => expect(fake.log.filter((l) => l.table === "trips" && l.op === "insert")).toHaveLength(1));
    const payload = fake.log.find((l) => l.table === "trips" && l.op === "insert").payload;
    // zawodnik jest ustawiony od razu (nie pusty, gdy lista zawodników wczytała się później)
    expect(payload.player_id).toBe("pl-1");
    expect(payload.tournament_id).toBe("t-3");
    expect(payload.departure_city).toBe("Zabrze");
  });

  it("duplikat wyjazdu (ten sam zawodnik, ten sam turniej) daje czytelny komunikat", async () => {
    const user = await open();
    const c = screen.getByText("Turniej U14 Sopot").closest(".glass-card");
    await user.click(within(c).getByRole("button", { name: "Jadę na ten turniej" }));
    await user.type(within(c).getByPlaceholderText("np. Katowice"), "Zabrze");
    fake.failNext("trips", "insert", { code: "23505", message: "duplicate key" });
    await user.click(within(c).getByRole("button", { name: "Potwierdź wyjazd" }));
    expect(await within(c).findByText("Ten zawodnik już ma zgłoszony wyjazd na ten turniej.")).toBeInTheDocument();
  });

  it("inny błąd zapisu wyjazdu pokazuje jego treść zamiast ciszy", async () => {
    const user = await open();
    const c = screen.getByText("Turniej U14 Sopot").closest(".glass-card");
    await user.click(within(c).getByRole("button", { name: "Jadę na ten turniej" }));
    await user.type(within(c).getByPlaceholderText("np. Katowice"), "Zabrze");
    fake.failNext("trips", "insert", { message: "Brak połączenia z bazą" });
    await user.click(within(c).getByRole("button", { name: "Potwierdź wyjazd" }));
    expect(await within(c).findByText("Brak połączenia z bazą")).toBeInTheDocument();
  });

  it("bez dodanego zawodnika prowadzi do Profilu", async () => {
    fake.db.players = [];
    fake.db.trips = [];
    const user = userEvent.setup();
    renderWithApp(<TournamentsPage />);
    await screen.findByText("Turniej U14 Sopot");
    const c = screen.getByText("Turniej U14 Sopot").closest(".glass-card");
    await user.click(within(c).getByRole("button", { name: "Jadę na ten turniej" }));
    expect(await within(c).findByText(/Najpierw dodaj zawodnika/)).toBeInTheDocument();
    expect(within(c).getByRole("link", { name: "Dodaj zawodnika w Profilu" })).toHaveAttribute("href", "/profil");
  });
});

describe("Start", () => {
  const open = async () => {
    renderWithApp(<StartPage />);
    return userEvent.setup();
  };

  it("wita po imieniu (pierwszy człon imienia i nazwiska)", async () => {
    await open();
    expect(await screen.findByRole("heading", { name: /Cześć, Test!/ })).toBeInTheDocument();
  });

  it("pokazuje najbliższy wyjazd z miastem wyjazdu", async () => {
    await open();
    expect(await screen.findByText(/Najbliższy wyjazd/)).toBeInTheDocument();
    expect(screen.getByText("Turniej U12 Warszawa", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Wyjazd z: Zabrze/)).toBeInTheDocument();
  });

  it("bez zawodnika podpowiada pierwszy krok", async () => {
    fake.db.players = [];
    fake.db.trips = [];
    await open();
    expect(await screen.findByText(/Zacznij od dodania zawodnika/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dodaj zawodnika" })).toHaveAttribute("href", "/profil");
  });

  it("ma skróty do czterech głównych zakładek", async () => {
    await open();
    await screen.findByText("Skróty");
    for (const [name, href] of [["Turnieje", "/turnieje"], ["Przejazdy", "/przejazdy"], ["Noclegi", "/noclegi"], ["Wiadomości", "/wiadomosci"]]) {
      expect(screen.getByRole("link", { name: new RegExp(name) })).toHaveAttribute("href", href);
    }
  });

  it("pokazuje baner z godziną ostatniej synchronizacji danych", async () => {
    await open();
    expect(await screen.findByText(/Dane turniejów zaktualizowano dziś o \d{2}:\d{2}/)).toBeInTheDocument();
  });

  it("starsza synchronizacja pokazuje datę zamiast 'dziś'", async () => {
    fake.db.data_sync_status = [{ key: "tournaments", last_synced_at: new Date(Date.now() - 3 * 864e5).toISOString(), last_count: 3 }];
    await open();
    const banner = await screen.findByText(/Dane turniejów zaktualizowano/);
    expect(banner.textContent).not.toMatch(/dziś/);
    expect(banner.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it("zamknięcie banera ukrywa go do końca dnia (zapamiętane w sesji)", async () => {
    const user = await open();
    await user.click(await screen.findByRole("button", { name: "Zamknij" }));
    expect(screen.queryByText(/Dane turniejów zaktualizowano/)).not.toBeInTheDocument();
    cleanup();
    await open();
    await screen.findByText("Skróty");
    expect(screen.queryByText(/Dane turniejów zaktualizowano/)).not.toBeInTheDocument();
  });

  it("'Odśwież teraz' odświeża dane i zamyka baner", async () => {
    const user = await open();
    await user.click(await screen.findByRole("button", { name: "Odśwież teraz" }));
    await waitFor(() => expect(screen.queryByText(/Dane turniejów zaktualizowano/)).not.toBeInTheDocument());
    expect(sessionStorage.getItem("tennis-together-sync-banner-dismissed-on")).toBe(new Date().toDateString());
  });

  it("bez wiersza statusu synchronizacji baner się nie pokazuje", async () => {
    fake.db.data_sync_status = [];
    await open();
    await screen.findByText("Skróty");
    expect(screen.queryByText(/Dane turniejów zaktualizowano/)).not.toBeInTheDocument();
  });

  it("trener widzi liczbę wyjazdów klubu", async () => {
    fake.db.accounts[0].role = "coach";
    await open();
    expect(await screen.findByText(/Klub|klub/)).toBeInTheDocument();
  });
});

describe("Moje wyjazdy", () => {
  async function open() {
    const user = userEvent.setup();
    renderWithApp(<TripsPage />);
    await screen.findByRole("heading", { name: "Moje wyjazdy" });
    return user;
  }

  it("ma trzy zakładki: nadchodzące, w trakcie organizacji, zakończone", async () => {
    await open();
    for (const n of ["Nadchodzące", "W trakcie organizacji", "Zakończone"]) expect(screen.getByRole("button", { name: n })).toBeInTheDocument();
  });

  it("wyjazd w organizacji pokazuje transport i nocleg oraz przycisk kalendarza", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "W trakcie organizacji" }));
    const c = (await screen.findByText("Turniej U12 Warszawa")).closest(".glass-card");
    expect(within(c).getByText(/Transport/)).toBeInTheDocument();
    expect(within(c).getByText(/Nocleg/)).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: /Dodaj do kalendarza/ })).toBeInTheDocument();
  });

  it("'Dodaj do kalendarza' pobiera plik .ics z nazwą zawierającą datę turnieju", async () => {
    const blobs = [];
    globalThis.URL.createObjectURL = vi.fn((b) => (blobs.push(b), "blob:x"));
    globalThis.URL.revokeObjectURL = vi.fn();
    let name = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { name = this.download; };
    const user = await open();
    await user.click(screen.getByRole("button", { name: "W trakcie organizacji" }));
    const c = (await screen.findByText("Turniej U12 Warszawa")).closest(".glass-card");
    await user.click(within(c).getByRole("button", { name: /Dodaj do kalendarza/ }));
    HTMLAnchorElement.prototype.click = orig;
    expect(name).toBe("wyjazd-2099-10-20.ics");
    const text = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsText(blobs[0]);
    });
    expect(text).toContain("DTSTART;VALUE=DATE:20991020");
  });

  it("zakładka Zakończone jest pusta, gdy nie ma zakończonych wyjazdów", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Zakończone" }));
    expect(await screen.findByText(/Brak wyjazdów w tej kategorii/)).toBeInTheDocument();
  });

  it("status ustalenia pokazuje przejazd i nocleg z oznaczeniami z bazy", async () => {
    fake.rpcHandlers.trip_arrangements = () => ({
      data: [{ trip_id: "trip-me-1", ride_status: "arranged", lodging_status: "pending" }],
      error: null,
    });
    const user = await open();
    await user.click(screen.getByRole("button", { name: "W trakcie organizacji" }));
    const c = (await screen.findByText("Turniej U12 Warszawa")).closest(".glass-card");
    expect(await within(c).findByText("Załatwiony ✅")).toBeInTheDocument();
    expect(within(c).getByText("Prośba czeka na odpowiedź")).toBeInTheDocument();
  });

  it("gdy funkcja statusów zawiedzie, pokazuje uczciwe 'brak danych' (kreski)", async () => {
    fake.rpcHandlers.trip_arrangements = () => ({ data: null, error: { message: "brak funkcji" } });
    const user = await open();
    await user.click(screen.getByRole("button", { name: "W trakcie organizacji" }));
    const c = (await screen.findByText("Turniej U12 Warszawa")).closest(".glass-card");
    await waitFor(() => expect(within(c).getAllByText("—").length).toBeGreaterThanOrEqual(2));
  });
});
