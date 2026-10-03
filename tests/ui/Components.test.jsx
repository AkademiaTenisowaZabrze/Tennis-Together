// Komponenty zaufania i spotkań: pineska na mapie, potwierdzanie kodem, oceny, karta rozmówcy.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/supabase.js", async () => await import("../helpers/fakeSupabase.js"));
// Mapa Leaflet jest zastąpiona prostym przyciskiem, który "klika" w wybrany punkt.
vi.mock("../../src/components/LeafletMap.jsx", () => ({
  default: ({ onPick, marker }) => (
    <div>
      <span data-testid="marker">{marker ? `${marker.lat},${marker.lng}` : "brak"}</span>
      {onPick && <button onClick={() => onPick(50.3, 18.7)}>KLIKNIJ-MAPE</button>}
    </div>
  ),
}));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async (t) => `data:image/png;base64,QR-${t}`) } }));

import { fake, ME, OTHER } from "../helpers/fakeSupabase.js";
import MeetingPoint from "../../src/components/MeetingPoint.jsx";
import MeetingConfirmation from "../../src/components/MeetingConfirmation.jsx";
import RateMatchForm from "../../src/components/RateMatchForm.jsx";
import StarRating from "../../src/components/StarRating.jsx";
import CounterpartCard from "../../src/components/CounterpartCard.jsx";
import { renderWithApp } from "../helpers/render.jsx";

beforeEach(() => fake.reset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rpcCalls = (name) => fake.log.filter((l) => l.op === "rpc" && l.name === name);

describe("MeetingPoint: pineska miejsca spotkania", () => {
  const baseRequest = { id: "req-1", status: "accepted", meeting_lat: null, meeting_lng: null, meeting_place: null };
  const show = (request = baseRequest, extra = {}) => {
    const onSaved = vi.fn();
    render(<MeetingPoint kind="ride" request={request} onSaved={onSaved} centerCity="Zabrze" {...extra} />);
    return { onSaved, user: userEvent.setup() };
  };

  it("bez pineski informuje, że miejsce nie jest ustalone, i pozwala je ustawić", () => {
    show();
    expect(screen.getByText(/Miejsce spotkania jeszcze nie ustalone/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ustaw miejsce spotkania" })).toBeInTheDocument();
  });

  it("zapis bez postawienia pineski pokazuje podpowiedź i nie wywołuje bazy", async () => {
    const { user } = show();
    await user.click(screen.getByRole("button", { name: "Ustaw miejsce spotkania" }));
    await user.click(screen.getByRole("button", { name: "Zapisz miejsce" }));
    expect(screen.getByText("Kliknij w mapę, żeby postawić pineskę, albo wyszukaj adres.")).toBeInTheDocument();
    expect(rpcCalls("set_meeting_point")).toHaveLength(0);
  });

  it("kliknięcie w mapę i zapis wysyła funkcję z rodzajem, id, współrzędnymi i opisem", async () => {
    fake.rpcHandlers.set_meeting_point = () => ({ data: { result: "ok" }, error: null });
    const { user, onSaved } = show();
    await user.click(screen.getByRole("button", { name: "Ustaw miejsce spotkania" }));
    await user.click(await screen.findByRole("button", { name: "KLIKNIJ-MAPE" }));
    await user.type(screen.getByPlaceholderText(/Opis miejsca/), "parking pod Biedronką");
    await user.click(screen.getByRole("button", { name: "Zapisz miejsce" }));
    await waitFor(() => expect(rpcCalls("set_meeting_point")).toHaveLength(1));
    expect(rpcCalls("set_meeting_point")[0].payload).toEqual({
      p_kind: "ride", p_request_id: "req-1", p_lat: 50.3, p_lng: 18.7, p_place: "parking pod Biedronką",
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Zapisz miejsce" })).not.toBeInTheDocument();
  });

  it("opis miejsca jest ograniczony do 120 znaków", async () => {
    const { user } = show();
    await user.click(screen.getByRole("button", { name: "Ustaw miejsce spotkania" }));
    expect(screen.getByPlaceholderText(/Opis miejsca/)).toHaveAttribute("maxLength", "120");
  });

  it("odpowiedź 'forbidden' tłumaczy, że miejsce ustawia się tylko przy zaakceptowanym przejeździe", async () => {
    fake.rpcHandlers.set_meeting_point = () => ({ data: { result: "forbidden" }, error: null });
    const { user } = show();
    await user.click(screen.getByRole("button", { name: "Ustaw miejsce spotkania" }));
    await user.click(await screen.findByRole("button", { name: "KLIKNIJ-MAPE" }));
    await user.click(screen.getByRole("button", { name: "Zapisz miejsce" }));
    expect(await screen.findByText(/tylko przy zaakceptowanym przejeździe/)).toBeInTheDocument();
  });

  it("odpowiedź 'invalid' mówi o nieprawidłowym miejscu na mapie", async () => {
    fake.rpcHandlers.set_meeting_point = () => ({ data: { result: "invalid" }, error: null });
    const { user } = show();
    await user.click(screen.getByRole("button", { name: "Ustaw miejsce spotkania" }));
    await user.click(await screen.findByRole("button", { name: "KLIKNIJ-MAPE" }));
    await user.click(screen.getByRole("button", { name: "Zapisz miejsce" }));
    expect(await screen.findByText("Nieprawidłowe miejsce na mapie.")).toBeInTheDocument();
  });

  it("błąd sieci przy zapisie pokazuje komunikat i zostawia edycję otwartą", async () => {
    fake.rpcHandlers.set_meeting_point = () => ({ data: null, error: { message: "timeout" } });
    const { user } = show();
    await user.click(screen.getByRole("button", { name: "Ustaw miejsce spotkania" }));
    await user.click(await screen.findByRole("button", { name: "KLIKNIJ-MAPE" }));
    await user.click(screen.getByRole("button", { name: "Zapisz miejsce" }));
    expect(await screen.findByText(/Nie udało się zapisać miejsca spotkania/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zapisz miejsce" })).toBeInTheDocument();
  });

  it("z pineską pokazuje opis, mapę i link do map z bezpiecznym rel", () => {
    show({ ...baseRequest, meeting_lat: 50.3, meeting_lng: 18.7, meeting_place: "dworzec" });
    expect(screen.getByText("📍 Miejsce spotkania: dworzec")).toBeInTheDocument();
    expect(screen.getByTestId("marker")).toHaveTextContent("50.3,18.7");
    const link = screen.getByRole("link", { name: "Otwórz w mapach" });
    expect(link.getAttribute("href")).toBe("https://www.google.com/maps/search/?api=1&query=50.3,18.7");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("'Usuń pineskę' czyści miejsce (współrzędne null)", async () => {
    fake.rpcHandlers.set_meeting_point = () => ({ data: { result: "ok" }, error: null });
    const { user } = show({ ...baseRequest, meeting_lat: 50.3, meeting_lng: 18.7, meeting_place: "x" });
    await user.click(screen.getByRole("button", { name: "Zmień miejsce" }));
    await user.click(screen.getByRole("button", { name: "Usuń pineskę" }));
    await waitFor(() => expect(rpcCalls("set_meeting_point")).toHaveLength(1));
    expect(rpcCalls("set_meeting_point")[0].payload).toMatchObject({ p_lat: null, p_lng: null, p_place: null });
  });

  it("pineska dla zapytania o podwiezienie używa rodzaju 'ride_ping'", async () => {
    fake.rpcHandlers.set_meeting_point = () => ({ data: { result: "ok" }, error: null });
    const onSaved = vi.fn();
    render(<MeetingPoint kind="ride_ping" request={baseRequest} onSaved={onSaved} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Ustaw miejsce spotkania" }));
    await user.click(await screen.findByRole("button", { name: "KLIKNIJ-MAPE" }));
    await user.click(screen.getByRole("button", { name: "Zapisz miejsce" }));
    await waitFor(() => expect(rpcCalls("set_meeting_point")[0].payload.p_kind).toBe("ride_ping"));
  });

  describe("wyszukiwanie adresu (Nominatim)", () => {
    const search = (text) => {
      const user = userEvent.setup();
      return user.type(screen.getByPlaceholderText(/Wyszukaj adres/), text);
    };

    it("pisanie w polu NIE wysyła zapytań (tylko przycisk Szukaj)", async () => {
      const f = vi.spyOn(globalThis, "fetch").mockResolvedValue({ json: async () => [] });
      const { user } = show();
      await user.click(screen.getByRole("button", { name: "Ustaw miejsce spotkania" }));
      await search("Zabrze Wolności 1");
      expect(f).not.toHaveBeenCalled();
    });

    it("po kliknięciu Szukaj pyta Nominatim o adres w Polsce i stawia pineskę", async () => {
      const f = vi.spyOn(globalThis, "fetch").mockResolvedValue({ json: async () => [{ lat: "50.30", lon: "18.77", display_name: "Wolności 1, Zabrze, Śląskie, Polska" }] });
      const { user } = show();
      await user.click(screen.getByRole("button", { name: "Ustaw miejsce spotkania" }));
      await search("Zabrze Wolności 1");
      await user.click(screen.getByRole("button", { name: "Szukaj" }));
      await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
      const url = String(f.mock.calls[0][0]);
      expect(url).toMatch(/^https:\/\/nominatim\.openstreetmap\.org\/search/);
      expect(url).toContain("countrycodes=pl");
      expect(url).toContain(encodeURIComponent("Zabrze Wolności 1"));
      expect(await screen.findByTestId("marker")).toHaveTextContent("50.3,18.77");
      expect(screen.getByPlaceholderText(/Opis miejsca/).value).toBe("Wolności 1, Zabrze");
    });

    it("brak wyników: komunikat po polsku", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({ json: async () => [] });
      const { user } = show();
      await user.click(screen.getByRole("button", { name: "Ustaw miejsce spotkania" }));
      await search("Nieistniejąca 999");
      await user.click(screen.getByRole("button", { name: "Szukaj" }));
      expect(await screen.findByText(/Nie znaleziono takiego adresu/)).toBeInTheDocument();
    });

    it("awaria wyszukiwarki nie psuje formularza: podpowiada kliknięcie w mapę", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
      const { user } = show();
      await user.click(screen.getByRole("button", { name: "Ustaw miejsce spotkania" }));
      await search("Zabrze");
      await user.click(screen.getByRole("button", { name: "Szukaj" }));
      expect(await screen.findByText(/Wyszukiwanie adresu nie działa/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "KLIKNIJ-MAPE" })).toBeInTheDocument();
    });

    it("puste zapytanie nie wywołuje wyszukiwarki", async () => {
      const f = vi.spyOn(globalThis, "fetch").mockResolvedValue({ json: async () => [] });
      const { user } = show();
      await user.click(screen.getByRole("button", { name: "Ustaw miejsce spotkania" }));
      await user.click(screen.getByRole("button", { name: "Szukaj" }));
      expect(f).not.toHaveBeenCalled();
    });
  });
});

describe("MeetingConfirmation: potwierdzenie spotkania kodem", () => {
  const make = (over = {}) => ({
    generateMeetingCode: vi.fn(async () => ({ data: { meeting_code: "AB3D5F" } })),
    verifyMeetingCode: vi.fn(async () => ({ data: {} })),
    ...over,
  });
  const show = (request = { id: "r1", meeting_code: "AB3D5F", meeting_confirmed_at: null }, jr = make()) => {
    render(<MeetingConfirmation request={request} joinRequests={jr} />);
    return { jr, user: userEvent.setup() };
  };

  it("potwierdzone spotkanie pokazuje tylko odznakę", () => {
    show({ id: "r1", meeting_confirmed_at: "2026-10-02T10:00:00Z" });
    expect(screen.getByText("🤝 Spotkanie potwierdzone")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("'Pokaż mój kod' generuje kod i pokazuje kod QR oraz kod tekstowy", async () => {
    const { user, jr } = show();
    await user.click(screen.getByRole("button", { name: /Pokaż mój kod/ }));
    expect(jr.generateMeetingCode).toHaveBeenCalledWith("r1");
    const qr = await screen.findByAltText("Kod QR do potwierdzenia spotkania");
    expect(qr.getAttribute("src")).toContain("QR-AB3D5F");
    expect(screen.getByText("AB3D5F")).toBeInTheDocument();
  });

  it("błąd generowania kodu pokazuje komunikat", async () => {
    const { user } = show(undefined, make({ generateMeetingCode: vi.fn(async () => ({ error: { message: "x" } })) }));
    await user.click(screen.getByRole("button", { name: /Pokaż mój kod/ }));
    expect(await screen.findByText("Nie udało się wygenerować kodu.")).toBeInTheDocument();
  });

  it("wpisany kod jest zamieniany na wielkie litery i wysyłany do weryfikacji", async () => {
    const { user, jr } = show();
    await user.click(screen.getByRole("button", { name: /Wpisz kod drugiej osoby/ }));
    await user.type(screen.getByPlaceholderText("np. 4F7K2A"), "ab3d5f");
    expect(screen.getByPlaceholderText("np. 4F7K2A")).toHaveValue("AB3D5F");
    await user.click(screen.getByRole("button", { name: "Potwierdź" }));
    expect(jr.verifyMeetingCode).toHaveBeenCalledWith("r1", "AB3D5F");
  });

  it("pusty kod nie jest wysyłany", async () => {
    const { user, jr } = show();
    await user.click(screen.getByRole("button", { name: /Wpisz kod drugiej osoby/ }));
    await user.click(screen.getByRole("button", { name: "Potwierdź" }));
    expect(jr.verifyMeetingCode).not.toHaveBeenCalled();
  });

  const failureCases = [
    [{ failure: "mismatch", attemptsLeft: 3 }, /Kod się nie zgadza.*pozostało prób: 3/],
    [{ failure: "mismatch" }, /pozostało prób: 0/],
    [{ failure: "locked" }, /Zbyt wiele błędnych prób/],
    [{ failure: "own_code" }, /To Twój własny kod/],
    [{ failure: "no_code" }, /Druga osoba nie wygenerowała jeszcze kodu/],
    [{ failure: "forbidden" }, /Nie udało się potwierdzić/],
    [{ error: { message: "x" } }, /Nie udało się potwierdzić/],
  ];
  for (const [result, message] of failureCases) {
    it(`odpowiedź ${JSON.stringify(result)} daje właściwy komunikat`, async () => {
      const { user } = show(undefined, make({ verifyMeetingCode: vi.fn(async () => result) }));
      await user.click(screen.getByRole("button", { name: /Wpisz kod drugiej osoby/ }));
      await user.type(screen.getByPlaceholderText("np. 4F7K2A"), "ZZZZZZ");
      await user.click(screen.getByRole("button", { name: "Potwierdź" }));
      expect(await screen.findByText(message)).toBeInTheDocument();
    });
  }

  it("'Anuluj' wraca do dwóch przycisków", async () => {
    const { user } = show();
    await user.click(screen.getByRole("button", { name: /Wpisz kod drugiej osoby/ }));
    await user.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(screen.getByRole("button", { name: /Pokaż mój kod/ })).toBeInTheDocument();
  });

  it("kod z alfabetu bez znaków mylących (0, O, 1, I) i o długości 6", async () => {
    const src = (await import("node:fs")).readFileSync("src/lib/useJoinRequests.js", "utf-8");
    const alphabet = /MEETING_CODE_ALPHABET = "([A-Z0-9]+)"/.exec(src)[1];
    expect(alphabet).not.toMatch(/[01OI]/);
    expect(alphabet.length).toBe(32);
    expect(src).toMatch(/length: 6/);
  });
});

describe("RateMatchForm: ocena po spotkaniu", () => {
  const props = { joinRequestId: "req-9", kind: "ride", raterAccountId: ME, ratedAccountId: OTHER };

  it("pokazuje formularz, gdy jeszcze nie oceniono", async () => {
    render(<RateMatchForm {...props} />);
    expect(await screen.findByText("Jak poszło?")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /gwiazdek/ })).toHaveLength(5);
  });

  it("jeśli już oceniono, pokazuje tylko odznakę", async () => {
    fake.db.ratings.push({ id: "x", join_request_id: "req-9", join_request_kind: "ride" });
    render(<RateMatchForm {...props} />);
    expect(await screen.findByText("⭐ Oceniono")).toBeInTheDocument();
    expect(screen.queryByText("Jak poszło?")).not.toBeInTheDocument();
  });

  it("wysłanie bez gwiazdek jest zablokowane komunikatem", async () => {
    render(<RateMatchForm {...props} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Wyślij ocenę" }));
    expect(screen.getByText("Wybierz liczbę gwiazdek.")).toBeInTheDocument();
    expect(fake.log.filter((l) => l.table === "ratings" && l.op === "insert")).toHaveLength(0);
  });

  it("ocena zapisuje gwiazdki i przyciętą treść komentarza", async () => {
    render(<RateMatchForm {...props} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "4 gwiazdek" }));
    await user.type(screen.getByPlaceholderText("Komentarz (opcjonalnie)"), "  Super jazda  ");
    await user.click(screen.getByRole("button", { name: "Wyślij ocenę" }));
    await waitFor(() => expect(fake.log.filter((l) => l.table === "ratings" && l.op === "insert")).toHaveLength(1));
    expect(fake.log.find((l) => l.table === "ratings" && l.op === "insert").payload).toEqual({
      join_request_id: "req-9", join_request_kind: "ride", rater_account_id: ME, rated_account_id: OTHER, stars: 4, comment: "Super jazda",
    });
    expect(await screen.findByText("⭐ Oceniono")).toBeInTheDocument();
  });

  it("pusty komentarz zapisuje się jako brak (null)", async () => {
    render(<RateMatchForm {...props} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "5 gwiazdek" }));
    await user.click(screen.getByRole("button", { name: "Wyślij ocenę" }));
    await waitFor(() => expect(fake.log.find((l) => l.table === "ratings" && l.op === "insert")).toBeTruthy());
    expect(fake.log.find((l) => l.table === "ratings" && l.op === "insert").payload.comment).toBeNull();
  });

  it("błąd zapisu oceny pokazuje komunikat i pozwala spróbować ponownie", async () => {
    render(<RateMatchForm {...props} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "3 gwiazdek" }));
    fake.failNext("ratings", "insert", { message: "denied" });
    await user.click(screen.getByRole("button", { name: "Wyślij ocenę" }));
    expect(await screen.findByText(/Nie udało się zapisać oceny/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wyślij ocenę" })).toBeEnabled();
  });
});

describe("StarRating i CounterpartCard", () => {
  it("średnia ocena pokazuje gwiazdkę, wartość i liczbę ocen", async () => {
    fake.rpcHandlers.account_rating = () => ({ data: { avg_stars: 4.5, count: 2 }, error: null });
    render(<StarRating accountId={OTHER} />);
    expect(await screen.findByText("⭐ 4.5 (2)")).toBeInTheDocument();
    expect(screen.getByTitle("2 ocen")).toBeInTheDocument();
  });

  it("pojedyncza ocena ma liczbę pojedynczą w podpowiedzi", async () => {
    fake.rpcHandlers.account_rating = () => ({ data: { avg_stars: 5, count: 1 }, error: null });
    render(<StarRating accountId={OTHER} />);
    expect(await screen.findByTitle("1 ocena")).toBeInTheDocument();
  });

  it("bez ocen nic nie pokazuje (nie ma zera gwiazdek)", async () => {
    fake.rpcHandlers.account_rating = () => ({ data: { avg_stars: null, count: 0 }, error: null });
    const { container } = render(<StarRating accountId={OTHER} />);
    await waitFor(() => expect(rpcCalls("account_rating")).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("karta rozmówcy pokazuje imię i inicjał, gdy nie ma zdjęcia", async () => {
    fake.rpcHandlers.match_profile = () => ({ data: [{ full_name: "Anna Kierowca", avatar_url: null, verified: true }], error: null });
    render(<CounterpartCard accountId={OTHER} />);
    expect(await screen.findByText("Anna Kierowca")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("karta rozmówcy nie pokazuje numeru telefonu ani e-maila nawet jeśli baza je zwróci", async () => {
    fake.rpcHandlers.match_profile = () => ({
      data: [{ full_name: "Anna Kierowca", avatar_url: null, verified: true, phone: "600700800", email: "a@b.pl" }],
      error: null,
    });
    const { container } = render(<CounterpartCard accountId={OTHER} />);
    await screen.findByText("Anna Kierowca");
    expect(container.textContent).not.toContain("600700800");
    expect(container.textContent).not.toContain("a@b.pl");
  });

  it("brak dopasowania (baza zwraca pusty wynik) nie pokazuje nic", async () => {
    fake.rpcHandlers.match_profile = () => ({ data: [], error: null });
    const { container } = render(<CounterpartCard accountId={OTHER} />);
    await waitFor(() => expect(rpcCalls("match_profile")).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("karta rozmówcy używa zdjęcia, gdy jest dodane", async () => {
    fake.rpcHandlers.match_profile = () => ({ data: [{ full_name: "Anna", avatar_url: "https://x/y.png" }], error: null });
    const { container } = render(<CounterpartCard accountId={OTHER} />);
    await screen.findByText("Anna");
    expect(container.querySelector("img")).toHaveAttribute("src", "https://x/y.png");
  });
});
