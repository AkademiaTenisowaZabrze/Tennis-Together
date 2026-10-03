// Ekran Przejazdy: oferty, zwrot kosztów z kalkulatorem, prośby o miejsce i odpowiedzi kierowcy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/supabase.js", async () => await import("../helpers/fakeSupabase.js"));
import { fake, ME, OTHER, suggestion } from "../helpers/fakeSupabase.js";
import RidesPage from "../../src/pages/RidesPage.jsx";
import { renderWithApp } from "../helpers/render.jsx";

beforeEach(() => fake.reset());
afterEach(() => cleanup());

async function open() {
  const user = userEvent.setup();
  renderWithApp(<RidesPage />);
  await screen.findAllByText("Turniej U12 Warszawa");
  return user;
}
const card = (text) => screen.getAllByText(text)[0].closest(".glass-card");
const inserts = (table) => fake.log.filter((l) => l.table === table && l.op === "insert");

describe("lista ofert", () => {
  it("pokazuje oferty ze zwrotem kosztów i bez zwrotu kosztów", async () => {
    await open();
    expect(screen.getByText(/zwrot kosztów: 95 zł od osoby/)).toBeInTheDocument();
    expect(screen.getByText(/bez zwrotu kosztów/)).toBeInTheDocument();
  });

  it("oferty są posortowane od najbliższej mojemu miastu", async () => {
    await open();
    // odległości pojawiają się po wczytaniu listy miast
    await screen.findAllByText(/~\d+ km od Ciebie/);
    const text = document.body.textContent;
    expect(text.indexOf("Gliwice")).toBeLessThan(text.indexOf("Katowice"));
  });

  it("pokazuje liczbę wolnych miejsc i bagaż", async () => {
    await open();
    expect(screen.getByText("3 wolne miejsca")).toBeInTheDocument();
    expect(screen.getByText(/2 torby/)).toBeInTheDocument();
  });

  it("własna oferta jest oznaczona i nie ma przycisku proszenia o miejsce", async () => {
    fake.db.ride_offers.push({ id: "ro-mine", trip_id: "trip-me-1", free_seats: 2, cost_refund: false, cost_per_person_pln: null, created_at: new Date().toISOString() });
    await open();
    expect(await screen.findByText("To Twoja oferta")).toBeInTheDocument();
  });

  it("gdy nikt nie dodał ofert, pokazuje komunikat", async () => {
    fake.db.ride_offers = [];
    renderWithApp(<RidesPage />);
    expect(await screen.findByText(/Nikt jeszcze nie zgłosił wolnego miejsca/)).toBeInTheDocument();
  });

  it("przełącznik pokazuje listę próśb o przejazd", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Szukam przejazdu" }));
    expect(await screen.findByText(/Nikt jeszcze nie szuka przejazdu/)).toBeInTheDocument();
  });
});

describe("dodawanie oferty: zwrot kosztów i zgoda na kalkulator", () => {
  async function openForm() {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "+ Mam wolne miejsce" }));
    return user;
  }

  it("domyślnie oferta jest bez zwrotu kosztów i nie pokazuje kalkulatora", async () => {
    await openForm();
    expect(screen.getByLabelText(/Chcę zwrotu kosztów paliwa/)).not.toBeChecked();
    expect(screen.queryByText(/Kalkulator aplikacji wylicza/)).not.toBeInTheDocument();
  });

  it("zaznaczenie zwrotu kosztów pokazuje kwotę z kalkulatora i pole zgody", async () => {
    const user = await openForm();
    await user.click(screen.getByLabelText(/Chcę zwrotu kosztów paliwa/));
    const expected = suggestion("trip-me-1")[0];
    expect(await screen.findByText(new RegExp(`${expected.per_person_pln} zł od osoby`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${expected.distance_km} km`))).toBeInTheDocument();
    expect(screen.getByLabelText(/Przyjmuję do wiadomości i zgadzam się na kwotę/)).not.toBeChecked();
  });

  it("bez zaznaczenia zgody oferta nie zostaje zapisana i widać komunikat", async () => {
    const user = await openForm();
    await user.click(screen.getByLabelText(/Chcę zwrotu kosztów paliwa/));
    await screen.findByText(/Kalkulator aplikacji wylicza/);
    await user.click(screen.getByRole("button", { name: "Dodaj ofertę" }));
    expect(await screen.findByText(/potwierdź zgodę na kwotę z kalkulatora/)).toBeInTheDocument();
    expect(inserts("ride_offers")).toHaveLength(0);
  });

  it("ze zgodą oferta zapisuje się, a kwotę wylicza baza (klient nie wysyła kwoty)", async () => {
    const user = await openForm();
    await user.click(screen.getByLabelText(/Chcę zwrotu kosztów paliwa/));
    await user.click(await screen.findByLabelText(/Przyjmuję do wiadomości i zgadzam się na kwotę/));
    await user.click(screen.getByRole("button", { name: "Dodaj ofertę" }));
    await waitFor(() => expect(inserts("ride_offers")).toHaveLength(1));
    const payload = inserts("ride_offers")[0].payload;
    expect(payload.cost_refund).toBe(true);
    expect(payload.cost_terms_accepted).toBe(true);
    expect(payload).not.toHaveProperty("cost_per_person_pln");
    await waitFor(() => expect(screen.getAllByText(/zwrot kosztów: \d+ zł od osoby/).length).toBeGreaterThanOrEqual(2));
  });

  it("odznaczenie zwrotu kosztów resetuje zgodę", async () => {
    const user = await openForm();
    const refund = screen.getByLabelText(/Chcę zwrotu kosztów paliwa/);
    await user.click(refund);
    await user.click(await screen.findByLabelText(/Przyjmuję do wiadomości i zgadzam się na kwotę/));
    await user.click(refund); // wyłącz
    await user.click(refund); // włącz ponownie
    expect(await screen.findByLabelText(/Przyjmuję do wiadomości i zgadzam się na kwotę/)).not.toBeChecked();
  });

  it("oferta bez zwrotu kosztów zapisuje się bez żadnych pól kwoty ani zgody", async () => {
    const user = await openForm();
    await user.click(screen.getByRole("button", { name: "Dodaj ofertę" }));
    await waitFor(() => expect(inserts("ride_offers")).toHaveLength(1));
    const payload = inserts("ride_offers")[0].payload;
    expect(payload.cost_refund).toBe(false);
    expect(payload.cost_terms_accepted).toBe(false);
    expect(payload).not.toHaveProperty("cost_per_person_pln");
  });

  it("dla trasy z miastem spoza listy pokazuje, że kwoty nie da się wyliczyć", async () => {
    fake.db.trips.push({ id: "trip-me-9", player_id: "pl-1", tournament_id: "t-3", created_by_account_id: ME, departure_city: "Wieś Nieznana", status: "planning", created_at: new Date().toISOString() });
    const user = await openForm();
    // wybieramy wyjazd na turniej w Sopocie (miasto wyjazdu spoza listy)
    await user.click(screen.getByRole("button", { name: /Turniej U14 Sopot/ }));
    await user.click(screen.getByLabelText(/Chcę zwrotu kosztów paliwa/));
    expect(await screen.findByText(/Nie da się wyliczyć kwoty dla tej trasy/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dodaj ofertę" }));
    expect(await screen.findByText(/Nie można wyliczyć kwoty dla tej trasy/)).toBeInTheDocument();
    expect(inserts("ride_offers")).toHaveLength(0);
  });

  it("tekst zgody wyjaśnia, że to zwrot kosztów, a nie zarobek, oraz że parametry ustala administrator", async () => {
    const user = await openForm();
    await user.click(screen.getByLabelText(/Chcę zwrotu kosztów paliwa/));
    const label = await screen.findByLabelText(/Przyjmuję do wiadomości i zgadzam się na kwotę/);
    const text = label.closest("label").textContent;
    expect(text).toMatch(/administrator/);
    expect(text).toMatch(/nie zarobek/);
  });

  it("bez zgłoszonych wyjazdów formularz odsyła do wyboru turnieju", async () => {
    fake.db.trips = [];
    const user = userEvent.setup();
    renderWithApp(<RidesPage />);
    await screen.findByRole("button", { name: "+ Mam wolne miejsce" });
    await user.click(screen.getByRole("button", { name: "+ Mam wolne miejsce" }));
    expect(await screen.findByText(/Najpierw zgłoś wyjazd na turniej/)).toBeInTheDocument();
  });
});

describe("prośba o miejsce i zgoda na kwotę", () => {
  async function pickOffer(offerText) {
    const user = await open();
    const c = card(offerText);
    await user.click(within(c).getByRole("button", { name: "Poproś o miejsce" }));
    return { user, c };
  }

  it("przed wysłaniem prośby pasażer widzi kwotę i wie, że zgadza się na nią", async () => {
    const { c } = await pickOffer("Turniej U12 Warszawa");
    expect(within(c).getByText(/Kierowca proponuje/)).toBeInTheDocument();
    expect(within(c).getByText(/95 zł od osoby/, { selector: "strong" })).toBeInTheDocument();
    expect(within(c).getByText(/zgadzasz się na tę kwotę/)).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: "Zgadzam się i proszę o miejsce" })).toBeInTheDocument();
  });

  it("wysłanie prośby zapisuje ją bez kwoty od klienta, a pokazuje uzgodnioną kwotę", async () => {
    const { user, c } = await pickOffer("Turniej U12 Warszawa");
    await user.click(within(c).getByRole("button", { name: "Zgadzam się i proszę o miejsce" }));
    await waitFor(() => expect(inserts("ride_join_requests")).toHaveLength(1));
    const payload = inserts("ride_join_requests")[0].payload;
    expect(payload).toEqual({ ride_offer_id: "ro-1", requester_trip_id: "trip-me-1" });
    expect(await screen.findByText(/Uzgodniony koszt: 95 zł od osoby/)).toBeInTheDocument();
    expect(screen.getByText(/Prośba wysłana/)).toBeInTheDocument();
  });

  it("oferta bez zwrotu kosztów nie wyświetla żadnej kwoty ani zgody", async () => {
    // pasażer ma wyjazd na turniej w Gdańsku
    fake.db.trips.push({ id: "trip-me-2", player_id: "pl-1", tournament_id: "t-2", created_by_account_id: ME, departure_city: "Zabrze", status: "planning", created_at: new Date().toISOString() });
    const { c } = await pickOffer("Turniej U12 Gdańsk");
    expect(within(c).queryByText(/Kierowca proponuje/)).not.toBeInTheDocument();
    expect(within(c).getByRole("button", { name: "Potwierdź prośbę" })).toBeInTheDocument();
  });

  it("prośbę o miejsce można wysłać tylko z wyjazdem na ten sam turniej", async () => {
    const user = await open();
    const c = card("Turniej U12 Gdańsk");
    await user.click(within(c).getByRole("button", { name: "Poproś o miejsce" }));
    expect(within(c).getByText(/Najpierw zgłoś wyjazd na/)).toBeInTheDocument();
    expect(within(c).queryByRole("button", { name: /Potwierdź prośbę|Zgadzam się/ })).not.toBeInTheDocument();
  });

  it("anulowanie wyboru zamyka formularz bez zapisu", async () => {
    const { user, c } = await pickOffer("Turniej U12 Warszawa");
    await user.click(within(c).getByRole("button", { name: "Anuluj" }));
    expect(within(c).getByRole("button", { name: "Poproś o miejsce" })).toBeInTheDocument();
    expect(inserts("ride_join_requests")).toHaveLength(0);
  });

  it("oczekującą prośbę można wycofać", async () => {
    fake.db.ride_join_requests.push({ id: "jr-1", ride_offer_id: "ro-1", requester_trip_id: "trip-me-1", status: "pending", agreed_cost_pln: 95, created_at: new Date().toISOString() });
    const user = await open();
    await user.click(await screen.findByRole("button", { name: "Cofnij prośbę" }));
    await waitFor(() => expect(fake.log.some((l) => l.table === "ride_join_requests" && l.op === "delete")).toBe(true));
  });

  it("zaakceptowany przejazd pozwala zrezygnować i pokazuje kartę kierowcy", async () => {
    fake.db.ride_join_requests.push({ id: "jr-2", ride_offer_id: "ro-1", requester_trip_id: "trip-me-1", status: "accepted", agreed_cost_pln: 95, created_at: new Date().toISOString() });
    await open();
    expect(await screen.findByText("Zaakceptowano ✅")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zrezygnuj z przejazdu" })).toBeInTheDocument();
    expect(screen.getByText(/Uzgodniony koszt: 95 zł od osoby/)).toBeInTheDocument();
  });
});

describe("kierowca: prośby do jego przejazdów", () => {
  beforeEach(() => {
    fake.db.ride_offers.push({ id: "ro-mine", trip_id: "trip-me-1", free_seats: 2, cost_refund: true, cost_terms_accepted: true, cost_per_person_pln: 85, created_at: new Date().toISOString() });
    fake.db.ride_join_requests.push({ id: "jr-in", ride_offer_id: "ro-mine", requester_trip_id: "trip-other-1", status: "pending", agreed_cost_pln: 85, created_at: new Date().toISOString() });
  });

  it("widzi, na jaką kwotę zgodził się pasażer", async () => {
    await open();
    expect(await screen.findByText(/zgoda na: 85 zł od osoby/)).toBeInTheDocument();
    expect(screen.getByText(/Prośby o dołączenie do Twoich przejazdów \(1\)/)).toBeInTheDocument();
  });

  it("akceptacja zapisuje status i pokazuje opcje spotkania", async () => {
    const user = await open();
    await user.click(await screen.findByRole("button", { name: "Akceptuj" }));
    await waitFor(() => expect(fake.db.ride_join_requests[0].status).toBe("accepted"));
    expect(await screen.findByText("Zaakceptowano ✅", { selector: ".status-pill" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pokaż mój kod/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ustaw miejsce spotkania/ })).toBeInTheDocument();
  });

  it("odrzucenie zapisuje status 'declined'", async () => {
    const user = await open();
    await user.click(await screen.findByRole("button", { name: "Odrzuć" }));
    await waitFor(() => expect(fake.db.ride_join_requests[0].status).toBe("declined"));
  });

  it("po akceptacji kierowca może zrezygnować", async () => {
    fake.db.ride_join_requests[0].status = "accepted";
    const user = await open();
    await user.click(await screen.findByRole("button", { name: "Zrezygnuj" }));
    await waitFor(() => expect(fake.db.ride_join_requests[0].status).toBe("cancelled"));
  });

  it("uzgodniona kwota nie zmienia się po akceptacji", async () => {
    const user = await open();
    await user.click(await screen.findByRole("button", { name: "Akceptuj" }));
    await waitFor(() => expect(fake.db.ride_join_requests[0].status).toBe("accepted"));
    expect(fake.db.ride_join_requests[0].agreed_cost_pln).toBe(85);
  });
});
