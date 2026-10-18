// Dostępność (STANDARD DESIGNU, część 8): każde pole ma etykietę powiązaną z kontrolką, każdy przycisk i link ma nazwę,
// grupy chipów mają opis, a rozmiary celów dotyku w CSS to co najmniej 44 px.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "node:fs";

vi.mock("../../src/lib/supabase.js", async () => await import("../helpers/fakeSupabase.js"));
import { fake } from "../helpers/fakeSupabase.js";
import App from "../../src/App.jsx";
import { renderWithApp } from "../helpers/render.jsx";
import { openDrawer } from "../helpers/nav.js";

beforeEach(() => {
  fake.reset();
  localStorage.clear();
});
afterEach(cleanup);

const accName = (el) =>
  (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim() ||
  [...el.querySelectorAll("img[alt]")].map((i) => i.getAttribute("alt")).join("").trim();

function audit() {
  const problems = [];
  for (const el of document.querySelectorAll("input, select, textarea")) {
    if (["hidden", "file"].includes(el.type)) continue;
    const named = (el.labels && el.labels.length > 0) || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
    if (!named) problems.push(`pole bez etykiety: <${el.tagName.toLowerCase()} ${el.type || ""}> "${el.placeholder || el.name || ""}"`);
  }
  for (const el of document.querySelectorAll("button, a[href], summary")) {
    if (!accName(el)) problems.push(`przycisk/link bez nazwy: <${el.tagName.toLowerCase()} class="${el.className}">`);
  }
  for (const label of document.querySelectorAll("label")) {
    const hasControl = label.control || label.querySelector("input, select, textarea");
    if (!hasControl) problems.push(`etykieta bez kontrolki: "${label.textContent.trim().slice(0, 40)}"`);
  }
  return problems;
}

async function settle() {
  await screen.findByRole("navigation", { name: "Główne zakładki" });
  await waitFor(() => expect(document.body.textContent).not.toMatch(/Wczytywanie/), { timeout: 2000 }).catch(() => {});
}

describe.each([
  ["Start", "/"],
  ["Turnieje", "/turnieje"],
  ["Przejazdy", "/wyjazdy/przejazdy"],
  ["Przejazdy z formularzem oferty", "/wyjazdy/przejazdy?dodaj=oferta"],
  ["Noclegi", "/wyjazdy/noclegi"],
  ["Moje wyjazdy", "/wyjazdy/moje"],
  ["Wiadomości", "/wiadomosci"],
  ["Profil", "/profil"],
])("ekran %s", (_name, route) => {
  it("pola, przyciski i etykiety mają nazwy i powiązania", async () => {
    renderWithApp(<App />, { route });
    await settle();
    expect(audit()).toEqual([]);
  });
});

describe("otwarte nakładki i formularze", () => {
  it("szuflada: linki i logotypy partnerów mają nazwy", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    await settle();
    await openDrawer(user);
    expect(audit()).toEqual([]);
    expect(screen.getByRole("link", { name: "Akademia Tenisowa Zabrze" })).toBeInTheDocument();
  });

  it("formularz ogłoszenia noclegowego i oferty noclegu u siebie", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />, { route: "/wyjazdy/noclegi" });
    await settle();
    await user.click(await screen.findByRole("button", { name: /Dodaj ogłoszenie noclegowe/ }));
    expect(audit()).toEqual([]);
    await user.click(screen.getByRole("button", { name: /Zaproponuj nocleg u siebie/ }));
    expect(audit()).toEqual([]);
  });

  it("grupy chipów w formularzach mają opis (role=group)", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />, { route: "/wyjazdy/noclegi" });
    await settle();
    await user.click(await screen.findByRole("button", { name: /Dodaj ogłoszenie noclegowe/ }));
    expect(screen.getByRole("group", { name: "Rodzaj" })).toBeInTheDocument();
  });

  it("formularz edycji profilu zawodnika ma powiązane etykiety, w tym login PZT", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />, { route: "/profil" });
    await settle();
    const add = screen.queryByRole("button", { name: /Dodaj zawodnika/ });
    if (add) await user.click(add);
    expect(audit()).toEqual([]);
  });
});

describe("logowanie i rejestracja", () => {
  it("pola hasła mają etykiety (htmlFor) i działają z getByLabelText", async () => {
    fake.setSession(null);
    const user = userEvent.setup();
    renderWithApp(<App />);
    expect(await screen.findByLabelText("Hasło")).toHaveAttribute("type", "password");
    expect(audit()).toEqual([]);
    await user.click(screen.getByRole("button", { name: /Zakładam konto/ }));
    expect(await screen.findByLabelText(/Hasło \(min\. 8 znaków\)/)).toBeInTheDocument();
    expect(audit()).toEqual([]);
  });
});

describe("cele dotyku w CSS (min. 44 px)", () => {
  const tokens = fs.readFileSync("src/styles/tokens.css", "utf-8");
  const comps = fs.readFileSync("src/styles/components.css", "utf-8");
  const shell = fs.readFileSync("src/styles/shell.css", "utf-8");
  const minHeight = (css, selector) => {
    const m = css.match(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
    const h = m && m[2].match(/min-height:\s*(\d+)px/);
    return h ? Number(h[1]) : null;
  };

  it.each([
    [tokens, ".chip"],
    [tokens, ".segmented button"],
    [comps, ".link-btn"],
  ])("%#: %s ma min-height >= 44px", (css, sel) => {
    expect(minHeight(css, sel), sel).toBeGreaterThanOrEqual(44);
  });

  it("linki partnerów w szufladzie i zakładki na komputerze mają co najmniej 44 px", () => {
    expect(shell).toMatch(/\.dr-foot \.partners a \{[^}]*min-height: 44px/);
    expect(shell).toMatch(/\.tabs a \{[^}]*min-height: 44px/);
  });

  it("przycisk oka w polu hasła ma co najmniej 44x44 px", () => {
    const src = fs.readFileSync("src/components/PasswordInput.jsx", "utf-8");
    expect(src).toMatch(/minWidth: 44/);
    expect(src).toMatch(/minHeight: 44/);
  });
});

describe("telefon: klawiatura ekranowa i paski systemowe", () => {
  it("pasek zakładek chowa się, gdy fokus jest w polu tekstowym, i wraca po jego opuszczeniu", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />, { route: "/wyjazdy/przejazdy?dodaj=oferta" });
    await settle();
    const tabs = screen.getByRole("navigation", { name: "Główne zakładki" });
    expect(tabs).not.toHaveClass("tabs-typing");
    await user.click(await screen.findByLabelText(/Miejsce na bagaż/));
    expect(tabs).toHaveClass("tabs-typing");
    await user.click(document.body);
    expect(tabs).not.toHaveClass("tabs-typing");
  });

  it("zaznaczenie pola wyboru (checkbox) nie chowa paska zakładek", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />, { route: "/wyjazdy/przejazdy?dodaj=oferta" });
    await settle();
    await user.click(await screen.findByLabelText(/Chcę zwrotu kosztów paliwa/));
    expect(screen.getByRole("navigation", { name: "Główne zakładki" })).not.toHaveClass("tabs-typing");
  });

  it("jednolite paski pod paskiem statusu i nawigacji mają wysokość bezpiecznych obszarów", () => {
    const shell = fs.readFileSync("src/styles/shell.css", "utf-8");
    expect(shell).toMatch(/body::before[\s\S]*?height: var\(--sat\)/);
    expect(shell).toMatch(/body::after[\s\S]*?height: var\(--sab\)/);
  });

  it("poziomo (landscape) elementy przyklejone do krawędzi uwzględniają boczne bezpieczne obszary", () => {
    const shell = fs.readFileSync("src/styles/shell.css", "utf-8");
    const tokens = fs.readFileSync("src/styles/tokens.css", "utf-8");
    expect(tokens).toMatch(/--sal: var\(--safe-area-inset-left, env\(safe-area-inset-left/);
    expect(tokens).toMatch(/--sar: var\(--safe-area-inset-right, env\(safe-area-inset-right/);
    expect(shell).toMatch(/\.menuBtn \{[^}]*left: calc\(12px \+ var\(--sal\)\)/);
    expect(shell).toMatch(/\.fab-wrap \{[^}]*right: calc\(12px \+ var\(--sar\)\)/);
    expect(shell).toMatch(/\.tabs \{[^}]*left: calc\(10px \+ var\(--sal\)\)[^}]*right: calc\(10px \+ var\(--sar\)\)/);
    expect(shell).toMatch(/\.app-main \{[^}]*calc\(16px \+ var\(--sar\)\)[^}]*calc\(16px \+ var\(--sal\)\)/);
  });
});
