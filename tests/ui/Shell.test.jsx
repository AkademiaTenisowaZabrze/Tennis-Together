// Szkielet aplikacji: przycisk menu, szuflada, akcja "＋" z okienkiem, "wstecz" i gesty (STANDARD DESIGNU, części 5-7).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within, waitFor, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/supabase.js", async () => await import("../helpers/fakeSupabase.js"));
import { fake } from "../helpers/fakeSupabase.js";
import App from "../../src/App.jsx";
import { renderWithApp } from "../helpers/render.jsx";
import { tabsNav, openDrawer } from "../helpers/nav.js";
import { layerCount } from "../../src/lib/layers.js";

beforeEach(() => {
  fake.reset();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterEach(() => cleanup());

const drawerEl = () => document.getElementById("drawer");

describe("szuflada menu", () => {
  it("przycisk menu ma aria-label, aria-controls i aria-expanded zgodne ze stanem", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    const btn = await screen.findByRole("button", { name: "Menu" });
    expect(btn).toHaveAttribute("aria-controls", "drawer");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("zamknięta szuflada jest inert i aria-hidden, otwarta nie", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    await tabsNav();
    expect(drawerEl()).toHaveAttribute("inert");
    expect(drawerEl()).toHaveAttribute("aria-hidden", "true");
    await openDrawer(user);
    expect(drawerEl()).not.toHaveAttribute("inert");
    expect(drawerEl()).toHaveAttribute("aria-hidden", "false");
  });

  it("zawiera pogrupowane sekcje: szybkie akcje, moje, pomoc, wygląd, wyloguj", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    const drawer = await openDrawer(user);
    for (const h of ["Szybkie akcje", "Moje", "Pomoc", "Wygląd"]) expect(within(drawer).getByText(h)).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Wyloguj" })).toBeInTheDocument();
    expect(within(drawer).getByText("Test Rodzic")).toBeInTheDocument();
  });

  it("zamyka się przyciskiem X, dotknięciem tła i klawiszem Esc", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    const menu = await screen.findByRole("button", { name: "Menu" });

    await openDrawer(user);
    await user.click(screen.getByRole("button", { name: "Zamknij menu" }));
    await waitFor(() => expect(menu).toHaveAttribute("aria-expanded", "false"));

    await openDrawer(user);
    await user.click(document.getElementById("drawerScrim"));
    await waitFor(() => expect(menu).toHaveAttribute("aria-expanded", "false"));

    await openDrawer(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(menu).toHaveAttribute("aria-expanded", "false"));
    await waitFor(() => expect(layerCount()).toBe(0));
  });

  it("przesunięcie palcem w lewo o więcej niż 80 px zamyka szufladę, krótsze nie", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    const menu = await screen.findByRole("button", { name: "Menu" });
    await openDrawer(user);
    fireEvent.touchStart(drawerEl(), { touches: [{ clientX: 300 }] });
    fireEvent.touchEnd(drawerEl(), { changedTouches: [{ clientX: 260 }] });
    expect(menu).toHaveAttribute("aria-expanded", "true");
    fireEvent.touchStart(drawerEl(), { touches: [{ clientX: 300 }] });
    fireEvent.touchEnd(drawerEl(), { changedTouches: [{ clientX: 180 }] });
    await waitFor(() => expect(menu).toHaveAttribute("aria-expanded", "false"));
  });

  it("przycisk wstecz przeglądarki zamyka szufladę, a nie opuszcza ekranu", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />, { route: "/turnieje" });
    const menu = await screen.findByRole("button", { name: "Menu" });
    await openDrawer(user);
    expect(layerCount()).toBe(1);
    window.history.back();
    await waitFor(() => expect(menu).toHaveAttribute("aria-expanded", "false"));
    expect(layerCount()).toBe(0);
    expect(screen.getByRole("heading", { name: "Turnieje" })).toBeInTheDocument();
  });

  it("link w szufladzie zamyka ją i przechodzi na ekran; po przejściu nie zostaje otwarta nakładka", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    const drawer = await openDrawer(user);
    await user.click(within(drawer).getByRole("link", { name: /Moje wyjazdy/ }));
    expect(await screen.findByRole("heading", { name: "Moje wyjazdy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
    expect(layerCount()).toBe(0);
  });

  it("wylogowanie z szuflady najpierw zamyka nakładkę, potem wywołuje wylogowanie", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    const drawer = await openDrawer(user);
    await user.click(within(drawer).getByRole("button", { name: "Wyloguj" }));
    await waitFor(() => expect(fake.authCalls.some((c) => c[0] === "signOut")).toBe(true));
  });
});

describe("akcja ＋ w prawym górnym rogu (wariant A: okienko z dwiema akcjami)", () => {
  it("jest na Starcie i w Wyjazdach, a nie ma jej na Turniejach, Wiadomościach i w Profilu", async () => {
    for (const [route, expected] of [["/", true], ["/wyjazdy/przejazdy", true], ["/wyjazdy/noclegi", true], ["/turnieje", false], ["/wiadomosci", false], ["/profil", false]]) {
      const { unmount } = renderWithApp(<App />, { route });
      await tabsNav();
      const btn = screen.queryByRole("button", { name: "Dodaj" });
      expect(!!btn, route).toBe(expected);
      unmount();
    }
  });

  it("dotknięcie pokazuje okienko z dwiema akcjami i oznacza stan (aria-expanded, haspopup)", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    const fab = await screen.findByRole("button", { name: "Dodaj" });
    expect(fab).toHaveAttribute("aria-haspopup", "menu");
    expect(fab).toHaveAttribute("aria-expanded", "false");
    await user.click(fab);
    expect(fab).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("menuitem").map((i) => i.textContent.trim());
    expect(items.some((t) => /Dodaj wyjazd na turniej/.test(t))).toBe(true);
    expect(items.some((t) => /Dodaj ofertę przejazdu/.test(t))).toBe(true);
  });

  it("Dodaj wyjazd na turniej prowadzi do listy turniejów", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    await user.click(await screen.findByRole("button", { name: "Dodaj" }));
    await user.click(screen.getByRole("menuitem", { name: /Dodaj wyjazd na turniej/ }));
    expect(await screen.findByRole("heading", { name: "Turnieje" })).toBeInTheDocument();
    expect(layerCount()).toBe(0);
  });

  it("Dodaj ofertę przejazdu otwiera Przejazdy od razu z formularzem oferty", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    await user.click(await screen.findByRole("button", { name: "Dodaj" }));
    await user.click(screen.getByRole("menuitem", { name: /Dodaj ofertę przejazdu/ }));
    expect(await screen.findByRole("heading", { name: "Przejazdy" })).toBeInTheDocument();
    // formularz oferty jest otwarty: przycisk przełączający ma etykietę "Anuluj"
    expect(await screen.findByRole("button", { name: "Anuluj" })).toBeInTheDocument();
  });

  it("zamyka się klawiszem Esc, dotknięciem poza okienkiem i przyciskiem wstecz", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    const fab = await screen.findByRole("button", { name: "Dodaj" });

    await user.click(fab);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(fab).toHaveAttribute("aria-expanded", "false"));

    await user.click(fab);
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(fab).toHaveAttribute("aria-expanded", "false"));

    await user.click(fab);
    expect(layerCount()).toBe(1);
    window.history.back();
    await waitFor(() => expect(fab).toHaveAttribute("aria-expanded", "false"));
    expect(layerCount()).toBe(0);
  });
});
