// Szkielet aplikacji (nawigacja, motyw, logotypy, zawieszenie konta) oraz ekran logowania i rejestracji.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, cleanup, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/supabase.js", async () => await import("../helpers/fakeSupabase.js"));
import { fake, ME } from "../helpers/fakeSupabase.js";
import App from "../../src/App.jsx";
import { renderWithApp } from "../helpers/render.jsx";

beforeEach(() => {
  fake.reset();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterEach(() => cleanup());

describe("szkielet aplikacji po zalogowaniu", () => {
  it("pokazuje nagłówek z logotypami ATZ i PZT jako linki w nowej karcie", async () => {
    renderWithApp(<App />);
    const atz = await screen.findByAltText("Akademia Tenisowa Zabrze");
    const pzt = screen.getByAltText("Polski Związek Tenisowy");
    expect(atz.closest("a")).toHaveAttribute("href", "https://www.akademiatenisowazabrze.pl/");
    expect(pzt.closest("a")).toHaveAttribute("href", "https://www.pzt.pl/");
    for (const a of [atz.closest("a"), pzt.closest("a")]) {
      expect(a).toHaveAttribute("target", "_blank");
      expect(a.getAttribute("rel")).toMatch(/noopener/);
    }
  });

  it("logotypy stoją po prawej stronie nazwy aplikacji i mają ten sam rozmiar", async () => {
    renderWithApp(<App />);
    const atz = await screen.findByAltText("Akademia Tenisowa Zabrze");
    const pzt = screen.getByAltText("Polski Związek Tenisowy");
    const brand = screen.getByText(/Tennis Together/, { selector: "strong" });
    const order = [brand, atz, pzt].map((el) => el.compareDocumentPosition(document.body));
    expect(brand.compareDocumentPosition(atz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(atz.compareDocumentPosition(pzt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(atz.style.height).toBe(pzt.style.height);
    expect(order).toHaveLength(3);
  });

  it("dolna nawigacja ma 7 zakładek dla rodzica (bez Klub)", async () => {
    renderWithApp(<App />);
    const nav = await screen.findByRole("navigation");
    const links = within(nav).getAllByRole("link").map((a) => a.textContent.trim());
    expect(links).toEqual(["Start", "Turnieje", "Przejazdy", "Noclegi", "Moje wyjazdy", "Wiadomości", "Profil"]);
  });

  it("trener widzi dodatkową zakładkę Klub", async () => {
    fake.db.accounts[0].role = "coach";
    renderWithApp(<App />);
    const nav = await screen.findByRole("navigation");
    expect(within(nav).getByRole("link", { name: "Klub" })).toHaveAttribute("href", "/klub");
  });

  it("przejście przez zakładki pokazuje właściwe ekrany", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    const nav = await screen.findByRole("navigation");
    const go = async (name, heading) => {
      await user.click(within(nav).getByRole("link", { name }));
      expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    };
    await go("Turnieje", "Turnieje");
    await go("Przejazdy", "Przejazdy");
    await go("Noclegi", "Noclegi");
    await go("Moje wyjazdy", "Moje wyjazdy");
    await go("Wiadomości", "Wiadomości");
    await go("Profil", "Profil");
  });

  it("domyślny motyw jest ciemny, a przełącznik zmienia go i zapamiętuje", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    const toggle = await screen.findByRole("button", { name: /Przełącz tryb jasny\/ciemny/ });
    expect(document.documentElement.dataset.theme).toBe("dark");
    await user.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("tennis-together-theme")).toBe("light");
    await user.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("zapamiętany motyw jasny jest przywracany po ponownym otwarciu", async () => {
    localStorage.setItem("tennis-together-theme", "light");
    renderWithApp(<App />);
    await screen.findByRole("navigation");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("zawieszone konto widzi ekran blokady zamiast aplikacji i może się wylogować", async () => {
    fake.db.accounts[0].status = "suspended";
    const user = userEvent.setup();
    renderWithApp(<App />);
    expect(await screen.findByRole("heading", { name: "Konto zawieszone" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Wyloguj" }));
    expect(fake.authCalls.some((c) => c[0] === "signOut")).toBe(true);
  });

  it("wylogowanie usuwa token powiadomień tego urządzenia z bazy", async () => {
    localStorage.setItem("tennis-together-push-token", "tok-123");
    fake.db.device_tokens.push({ id: "d1", account_id: ME, token: "tok-123" });
    const user = userEvent.setup();
    renderWithApp(<App />, { route: "/profil" });
    await user.click(await screen.findByRole("button", { name: "Wyloguj" }));
    await waitFor(() => expect(fake.db.device_tokens).toHaveLength(0));
    expect(localStorage.getItem("tennis-together-push-token")).toBeNull();
  });

  it("bez sesji pokazuje ekran logowania, bez nawigacji aplikacji", async () => {
    fake.setSession(null);
    renderWithApp(<App />);
    expect(await screen.findByRole("button", { name: "Zaloguj się" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

// Zapisuje kolejne stany ekranu: "shell" (aplikacja), "loading" (Wczytywanie), "other".
function watchScreens() {
  const states = [];
  const read = () => (document.querySelector("header") ? "shell" : /Wczytywanie/.test(document.body.textContent) ? "loading" : "other");
  const push = () => {
    const s = read();
    if (states.at(-1) !== s) states.push(s);
  };
  const obs = new MutationObserver(push);
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  push();
  return { states, stop: () => obs.disconnect() };
}

describe("wczytywanie konta po zalogowaniu (bez mignięć ekranu)", () => {
  it("aplikacja nie pojawia się przed wczytaniem konta: ekran główny wyświetla się dokładnie raz", async () => {
    const w = watchScreens();
    renderWithApp(<App />);
    await screen.findByRole("navigation");
    await new Promise((r) => setTimeout(r, 60));
    w.stop();
    expect(w.states.filter((s) => s === "shell")).toHaveLength(1);
    expect(w.states.at(-1)).toBe("shell");
  });

  it("odświeżenie tokenu (nowy obiekt sesji tego samego użytkownika) nie zasłania aplikacji ekranem ładowania", async () => {
    renderWithApp(<App />);
    await screen.findByRole("navigation");
    await new Promise((r) => setTimeout(r, 60));
    const w = watchScreens();
    await act(async () => {
      fake.emitAuth("TOKEN_REFRESHED", { user: { id: ME, email: "test@example.com" }, access_token: "nowy" });
      await new Promise((r) => setTimeout(r, 60));
    });
    w.stop();
    expect(w.states).toEqual(["shell"]);
  });

  it("wylogowanie i ponowne zalogowanie tego samego użytkownika też nie pokazuje aplikacji bez konta", async () => {
    renderWithApp(<App />);
    await screen.findByRole("navigation");
    await act(async () => {
      fake.emitAuth("SIGNED_OUT", null);
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(await screen.findByRole("button", { name: "Zaloguj się" })).toBeInTheDocument();
    const w = watchScreens();
    await act(async () => {
      fake.emitAuth("SIGNED_IN", { user: { id: ME, email: "test@example.com" }, access_token: "x" });
      await new Promise((r) => setTimeout(r, 100));
    });
    w.stop();
    expect(w.states.filter((s) => s === "shell")).toHaveLength(1);
  });

  it("gdy konta nie da się wczytać (błąd bazy), aplikacja nie zawiesza się na ekranie ładowania", async () => {
    fake.db.accounts = [];
    fake.failNext("accounts", "insert", { message: "zapis niedostępny", code: "42501" }); // nieudane utworzenie konta (klient zwraca { error })
    renderWithApp(<App />);
    await waitFor(() => expect(screen.queryByText("Wczytywanie…")).not.toBeInTheDocument(), { timeout: 2000 });
  });
});

describe("ekran logowania", () => {
  async function openAuth() {
    fake.setSession(null);
    const user = userEvent.setup();
    renderWithApp(<App />);
    await screen.findByRole("button", { name: "Zaloguj się" });
    return user;
  }
  const typeLogin = async (user, email = "a@b.pl", pass = "haslo1234") => {
    await user.type(screen.getAllByRole("textbox")[0], email);
    await user.type(document.querySelector("input[type=password]"), pass);
  };

  it("ma logotypy ATZ i PZT jako linki i numer wersji", async () => {
    await openAuth();
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain("https://www.akademiatenisowazabrze.pl/");
    expect(links).toContain("https://www.pzt.pl/");
    expect(screen.getByText(/Wersja /)).toBeInTheDocument();
  });

  it("logowanie wysyła e-mail i hasło", async () => {
    const user = await openAuth();
    await typeLogin(user);
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));
    await waitFor(() => expect(fake.authCalls.find((c) => c[0] === "signIn")).toBeTruthy());
    expect(fake.authCalls.find((c) => c[0] === "signIn")[1]).toEqual({ email: "a@b.pl", password: "haslo1234" });
  });

  it("błędne dane: czytelny komunikat po polsku", async () => {
    fake.setAuthResult("signIn", { data: {}, error: { message: "Invalid login credentials" } });
    const user = await openAuth();
    await typeLogin(user);
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));
    expect(await screen.findByText("Błędny e-mail lub hasło.")).toBeInTheDocument();
  });

  it("niepotwierdzony e-mail: komunikat z instrukcją", async () => {
    fake.setAuthResult("signIn", { data: {}, error: { message: "Email not confirmed" } });
    const user = await openAuth();
    await typeLogin(user);
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));
    expect(await screen.findByText(/nie jest jeszcze potwierdzony/)).toBeInTheDocument();
  });

  it("nieznany błąd serwera jest pokazany, nie połykany", async () => {
    fake.setAuthResult("signIn", { data: {}, error: { message: "Coś dziwnego" } });
    const user = await openAuth();
    await typeLogin(user);
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));
    expect(await screen.findByText("Coś dziwnego")).toBeInTheDocument();
  });

  it("reset hasła: wysyła prośbę z adresem powrotu i nie zdradza, czy konto istnieje", async () => {
    const user = await openAuth();
    await user.click(screen.getByRole("button", { name: "Nie pamiętasz hasła?" }));
    await user.type(screen.getAllByRole("textbox")[0], "ktos@example.com");
    await user.click(screen.getByRole("button", { name: /Wyślij link/ }));
    const call = await waitFor(() => fake.authCalls.find((c) => c[0] === "reset") ?? Promise.reject(new Error("brak")));
    expect(call[1]).toBe("ktos@example.com");
    expect(call[2].redirectTo).toMatch(/\/app\/$/);
    expect(await screen.findByText(/Jeśli konto z adresem ktos@example.com istnieje/)).toBeInTheDocument();
  });
});

describe("rejestracja", () => {
  async function openRegister() {
    fake.setSession(null);
    const user = userEvent.setup();
    renderWithApp(<App />);
    await user.click(await screen.findByRole("button", { name: "Zakładam konto" }));
    return user;
  }
  const fill = async (user, { name = "  Jan Kowalski ", email = "jan@example.com", pass = "dlugiehaslo1", accept = true } = {}) => {
    const boxes = screen.getAllByRole("textbox");
    await user.type(boxes[0], name);
    await user.type(boxes[1], email);
    await user.type(document.querySelector("input[type=password]"), pass);
    if (accept) await user.click(screen.getByRole("checkbox"));
  };

  it("pokazuje wybór roli: rodzic, opiekun, trener", async () => {
    await openRegister();
    for (const r of ["Rodzic", "Opiekun", "Trener / klub"]) expect(screen.getByRole("button", { name: r })).toBeInTheDocument();
  });

  it("wybór roli trenera uprzedza, że wymaga zatwierdzenia przez administratora (dawniej F2)", async () => {
    const user = await openRegister();
    expect(screen.queryByText(/wymaga zatwierdzenia/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Trener / klub" }));
    expect(screen.getByText(/wymaga zatwierdzenia przez administratora/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rodzic" }));
    expect(screen.queryByText(/wymaga zatwierdzenia/)).not.toBeInTheDocument();
  });

  it("za krótkie hasło: komunikat i brak wywołania rejestracji", async () => {
    const user = await openRegister();
    await fill(user, { pass: "krotkie" });
    await user.click(screen.getByRole("button", { name: /Załóż konto|Zarejestruj/ }));
    expect(await screen.findByText("Hasło musi mieć co najmniej 8 znaków.")).toBeInTheDocument();
    expect(fake.authCalls.find((c) => c[0] === "signUp")).toBeUndefined();
  });

  it("bez zaznaczenia zgody na regulamin rejestracja nie rusza (komunikat, brak wywołania signUp)", async () => {
    const user = await openRegister();
    await fill(user, { accept: false });
    await user.click(screen.getByRole("button", { name: /Załóż konto|Zarejestruj/ }));
    expect(await screen.findByText(/zaakceptuj regulamin i politykę prywatności/)).toBeInTheDocument();
    expect(fake.authCalls.find((c) => c[0] === "signUp")).toBeUndefined();
    expect(localStorage.getItem("tennis-together-pending-profile")).toBeNull();
  });

  it("formularz rejestracji linkuje do regulaminu i polityki prywatności (nowa karta, noopener)", async () => {
    await openRegister();
    const reg = screen.getByRole("link", { name: "regulamin" });
    const pol = screen.getByRole("link", { name: "politykę prywatności" });
    expect(reg.getAttribute("href")).toMatch(/\/regulamin\.html$/);
    expect(pol.getAttribute("href")).toMatch(/\/polityka-prywatnosci\.html$/);
    for (const a of [reg, pol]) {
      expect(a).toHaveAttribute("target", "_blank");
      expect(a.getAttribute("rel")).toMatch(/noopener/);
    }
  });

  it("poprawna rejestracja wysyła imię w metadanych i adres potwierdzenia", async () => {
    const user = await openRegister();
    await fill(user);
    await user.click(screen.getByRole("button", { name: /Załóż konto|Zarejestruj/ }));
    const call = await waitFor(() => fake.authCalls.find((c) => c[0] === "signUp") ?? Promise.reject(new Error("brak")));
    expect(call[1].email).toBe("jan@example.com");
    expect(call[1].options.data.full_name).toBe("Jan Kowalski");
    expect(call[1].options.emailRedirectTo).toMatch(/potwierdz-email\.html$/);
  });

  it("po rejestracji bez sesji pokazuje prośbę o sprawdzenie skrzynki", async () => {
    const user = await openRegister();
    await fill(user);
    await user.click(screen.getByRole("button", { name: /Załóż konto|Zarejestruj/ }));
    expect(await screen.findByText("Sprawdź swoją skrzynkę")).toBeInTheDocument();
    expect(screen.getByText(/jan@example.com/)).toBeInTheDocument();
  });

  it("zapisuje wybraną rolę i imię na czas potwierdzenia e-maila", async () => {
    const user = await openRegister();
    await user.click(screen.getByRole("button", { name: "Opiekun" }));
    await fill(user);
    await user.click(screen.getByRole("button", { name: /Załóż konto|Zarejestruj/ }));
    await waitFor(() => expect(localStorage.getItem("tennis-together-pending-profile")).not.toBeNull());
    const pending = JSON.parse(localStorage.getItem("tennis-together-pending-profile"));
    expect(pending).toMatchObject({ role: "guardian", full_name: "  Jan Kowalski " });
    expect(pending.terms_accepted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(pending.terms_version).toBeTruthy();
  });

  it("każda próba rejestracji trafia do licznika prób", async () => {
    const user = await openRegister();
    await fill(user);
    await user.click(screen.getByRole("button", { name: /Załóż konto|Zarejestruj/ }));
    await waitFor(() => expect(fake.log.some((l) => l.table === "signup_attempts" && l.op === "insert")).toBe(true));
  });

  it("gdy licznik prób jest pełny, ostrzega, ale nie blokuje rejestracji", async () => {
    fake.db.signup_attempts = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, created_at: new Date().toISOString() }));
    await openRegister();
    expect(await screen.findByText(/30\/30/)).toBeInTheDocument();
    expect(screen.getByText(/Limit rejestracji na tę godzinę prawdopodobnie wyczerpany/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Załóż konto" })).toBeEnabled();
  });

  it("błąd 'użytkownik już istnieje' jest przetłumaczony", async () => {
    fake.setAuthResult("signUp", { data: {}, error: { message: "User already registered" } });
    const user = await openRegister();
    await fill(user);
    await user.click(screen.getByRole("button", { name: /Załóż konto|Zarejestruj/ }));
    expect(await screen.findByText(/Konto z tym e-mailem już istnieje/)).toBeInTheDocument();
  });

  it("limit Supabase (rate limit) jest tłumaczony na komunikat o 30 kontach na godzinę", async () => {
    fake.setAuthResult("signUp", { data: {}, error: { message: "email rate limit exceeded" } });
    const user = await openRegister();
    await fill(user);
    await user.click(screen.getByRole("button", { name: /Załóż konto|Zarejestruj/ }));
    expect(await screen.findByText(/limit 30 rejestracji na godzinę/)).toBeInTheDocument();
  });

  it("ostrzega, że konto zakłada tylko dorosły", async () => {
    await openRegister();
    expect(screen.getByText(/Konto zakłada tylko dorosły/)).toBeInTheDocument();
  });
});

describe("prośba o rolę trenera (profil)", () => {
  afterEach(cleanup);

  it("konto z prośbą o rolę trenera widzi informację o oczekiwaniu na zatwierdzenie", async () => {
    fake.db.accounts.find((a) => a.id === ME).coach_requested = true;
    const user = userEvent.setup();
    renderWithApp(<App />);
    const nav = await screen.findByRole("navigation");
    await user.click(within(nav).getByRole("link", { name: "Profil" }));
    expect(await screen.findByText(/Prośba o rolę trenera czeka na zatwierdzenie/)).toBeInTheDocument();
  });

  it("zwykłe konto nie widzi takiej informacji", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    const nav = await screen.findByRole("navigation");
    await user.click(within(nav).getByRole("link", { name: "Profil" }));
    await screen.findByRole("heading", { name: "Profil" });
    expect(screen.queryByText(/czeka na zatwierdzenie/)).not.toBeInTheDocument();
  });
});
