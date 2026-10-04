// Captcha "nie jestem robotem" (Cloudflare Turnstile) przy logowaniu, rejestracji i resecie hasła.
// Włączana kluczem witryny VITE_TURNSTILE_SITE_KEY; bez klucza aplikacja działa jak dawniej
// (pokrywają to zwykłe testy w App_and_Auth.test.jsx).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/supabase.js", async () => await import("../helpers/fakeSupabase.js"));
import { fake } from "../helpers/fakeSupabase.js";
import App from "../../src/App.jsx";
import { renderWithApp } from "../helpers/render.jsx";

// Atrapa window.turnstile: zapamiętuje parametry widżetów i pozwala "rozwiązać" test.
let widgets;
let resets;
function installTurnstile() {
  widgets = [];
  resets = 0;
  window.turnstile = {
    render: (el, opts) => {
      widgets.push({ el, opts });
      return `w-${widgets.length}`;
    },
    reset: () => {
      resets += 1;
    },
    remove: () => {},
  };
}
const solve = async (token) => {
  const w = widgets[widgets.length - 1];
  await act(async () => w.opts.callback(token));
};

beforeEach(() => {
  fake.reset();
  fake.setSession(null);
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-site-key");
  installTurnstile();
});
afterEach(() => {
  cleanup();
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
  delete window.turnstile;
});

async function openLogin() {
  const user = userEvent.setup();
  renderWithApp(<App />);
  await screen.findByRole("button", { name: "Zaloguj się" });
  await waitFor(() => expect(widgets.length).toBe(1));
  return user;
}
const typeLogin = async (user) => {
  await user.type(screen.getAllByRole("textbox")[0], "a@b.pl");
  await user.type(document.querySelector("input[type=password]"), "haslo1234");
};

describe("logowanie z captchą", () => {
  it("renderuje widżet z kluczem witryny, a przycisk jest zablokowany do czasu rozwiązania", async () => {
    await openLogin();
    expect(widgets[0].opts.sitekey).toBe("test-site-key");
    expect(screen.getByRole("button", { name: "Zaloguj się" })).toBeDisabled();
    await solve("tok-1");
    expect(screen.getByRole("button", { name: "Zaloguj się" })).toBeEnabled();
  });

  it("po rozwiązaniu wysyła token razem z e-mailem i hasłem", async () => {
    const user = await openLogin();
    await typeLogin(user);
    await solve("tok-login");
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));
    await waitFor(() => expect(fake.authCalls.find((c) => c[0] === "signIn")).toBeTruthy());
    expect(fake.authCalls.find((c) => c[0] === "signIn")[1]).toEqual({
      email: "a@b.pl",
      password: "haslo1234",
      options: { captchaToken: "tok-login" },
    });
  });

  it("token jest jednorazowy: po próbie widżet jest resetowany, a przycisk znów zablokowany", async () => {
    fake.setAuthResult("signIn", { data: {}, error: { message: "Invalid login credentials" } });
    const user = await openLogin();
    await typeLogin(user);
    await solve("tok-1");
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));
    expect(await screen.findByText("Błędny e-mail lub hasło.")).toBeInTheDocument();
    await waitFor(() => expect(resets).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole("button", { name: "Zaloguj się" })).toBeDisabled());
  });

  it("wygaśnięcie tokenu blokuje przycisk, a błąd widżetu też", async () => {
    await openLogin();
    await solve("tok-1");
    const w = widgets[0];
    await act(async () => w.opts["expired-callback"]());
    expect(screen.getByRole("button", { name: "Zaloguj się" })).toBeDisabled();
    await solve("tok-2");
    expect(screen.getByRole("button", { name: "Zaloguj się" })).toBeEnabled();
    await act(async () => w.opts["error-callback"]());
    expect(screen.getByRole("button", { name: "Zaloguj się" })).toBeDisabled();
  });
});

describe("reset hasła z captchą", () => {
  it("wysyła token razem z prośbą o link", async () => {
    const user = await openLogin();
    await user.click(screen.getByRole("button", { name: "Nie pamiętasz hasła?" }));
    await waitFor(() => expect(widgets.length).toBe(2));
    await user.type(screen.getAllByRole("textbox")[0], "ktos@example.com");
    expect(screen.getByRole("button", { name: /Wyślij link/ })).toBeDisabled();
    await solve("tok-reset");
    await user.click(screen.getByRole("button", { name: /Wyślij link/ }));
    const call = await waitFor(() => fake.authCalls.find((c) => c[0] === "reset") ?? Promise.reject(new Error("brak")));
    expect(call[1]).toBe("ktos@example.com");
    expect(call[2].captchaToken).toBe("tok-reset");
  });
});

describe("rejestracja z captchą", () => {
  async function openRegister() {
    const user = userEvent.setup();
    renderWithApp(<App />);
    await user.click(await screen.findByRole("button", { name: "Zakładam konto" }));
    await waitFor(() => expect(widgets.length).toBeGreaterThan(0));
    return user;
  }
  const fill = async (user) => {
    const boxes = screen.getAllByRole("textbox");
    await user.type(boxes[0], "Jan Kowalski");
    await user.type(boxes[1], "jan@example.com");
    await user.type(document.querySelector("input[type=password]"), "dlugiehaslo1");
    await user.click(screen.getByRole("checkbox"));
  };

  it("przycisk zakładania konta jest zablokowany bez rozwiązanej captchy", async () => {
    const user = await openRegister();
    await fill(user);
    expect(screen.getByRole("button", { name: "Załóż konto" })).toBeDisabled();
    await solve("tok-r");
    expect(screen.getByRole("button", { name: "Załóż konto" })).toBeEnabled();
  });

  it("wysyła token w opcjach rejestracji razem z adresem potwierdzenia i imieniem", async () => {
    const user = await openRegister();
    await fill(user);
    await solve("tok-register");
    await user.click(screen.getByRole("button", { name: "Załóż konto" }));
    await waitFor(() => expect(fake.authCalls.find((c) => c[0] === "signUp")).toBeTruthy());
    const opts = fake.authCalls.find((c) => c[0] === "signUp")[1].options;
    expect(opts.captchaToken).toBe("tok-register");
    expect(opts.emailRedirectTo).toMatch(/potwierdz-email\.html$/);
    expect(opts.data.full_name).toBe("Jan Kowalski");
  });
});

describe("bez klucza witryny", () => {
  it("nie ma widżetu, a przyciski nie są blokowane (zachowanie sprzed captchy)", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    const user = userEvent.setup();
    renderWithApp(<App />);
    await screen.findByRole("button", { name: "Zaloguj się" });
    expect(screen.queryByTestId("captcha")).not.toBeInTheDocument();
    expect(widgets.length).toBe(0);
    expect(screen.getByRole("button", { name: "Zaloguj się" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Zakładam konto" }));
    expect(screen.getByRole("button", { name: "Załóż konto" })).toBeEnabled();
  });
});
