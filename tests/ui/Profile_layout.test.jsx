// Profil w nowym układzie: sekcje rozwijane z podsumowaniem zamiast długiej płaskiej listy (STANDARD DESIGNU, zasada 2).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/supabase.js", async () => await import("../helpers/fakeSupabase.js"));
import { fake, ME } from "../helpers/fakeSupabase.js";
import App from "../../src/App.jsx";
import { renderWithApp } from "../helpers/render.jsx";
import { goProfile } from "../helpers/nav.js";

beforeEach(() => {
  fake.reset();
  localStorage.clear();
  fake.db.consents = [
    { id: "c-1", player_id: "pl-1", given_by_account_id: ME, consent_type: "host_family_stay", granted: true, created_at: "2099-01-01T10:00:00Z", players: { first_name: "Kuba" } },
    { id: "c-2", player_id: "pl-1", given_by_account_id: ME, consent_type: "terms", granted: false, created_at: "2098-01-01T10:00:00Z", players: { first_name: "Kuba" } },
  ];
});
afterEach(cleanup);

async function open() {
  const user = userEvent.setup();
  renderWithApp(<App />);
  await goProfile(user);
  return user;
}
const section = (id) => document.querySelector(`details[data-sec="${id}"]`);

describe("Profil: sekcje", () => {
  it("ma sekcje: Dane konta, Zgody, Historia wyjazdów, Dane i prywatność", async () => {
    await open();
    for (const id of ["profil-dane", "profil-zgody", "profil-historia", "profil-prywatnosc"]) expect(section(id), id).toBeTruthy();
  });

  it("Dane konta są otwarte domyślnie, pozostałe zwinięte", async () => {
    await open();
    expect(section("profil-dane")).toHaveAttribute("open");
    for (const id of ["profil-zgody", "profil-historia", "profil-prywatnosc"]) expect(section(id), id).not.toHaveAttribute("open");
  });

  it("podsumowanie zgód mówi, ile jest udzielonych i wycofanych", async () => {
    await open();
    expect(within(section("profil-zgody")).getByText("1 udzielone, 1 wycofane")).toBeInTheDocument();
  });

  it("podsumowanie danych konta pokazuje e-mail, a historia 'brak zakończonych'", async () => {
    await open();
    expect(within(section("profil-dane")).getAllByText("test@example.com").length).toBeGreaterThan(0);
    expect(within(section("profil-historia")).getByText("brak zakończonych")).toBeInTheDocument();
  });

  it("otwarcie sekcji jest zapamiętywane między wizytami na ekranie", async () => {
    await open();
    const zgody = section("profil-zgody");
    zgody.open = true;
    fireEvent(zgody, new Event("toggle"));
    cleanup();
    await open();
    expect(section("profil-zgody")).toHaveAttribute("open");
  });

  it("Dane i prywatność zawierają linki do regulaminu i polityki oraz usunięcie konta", async () => {
    await open();
    const sec = section("profil-prywatnosc");
    expect(within(sec).getByRole("link", { name: /Regulamin/ })).toHaveAttribute("href", expect.stringMatching(/regulamin\.html$/));
    expect(within(sec).getByRole("link", { name: /Polityka prywatności/ })).toHaveAttribute("href", expect.stringMatching(/polityka-prywatnosci\.html$/));
    expect(within(sec).getByRole("button", { name: "Usuń konto" })).toHaveClass("btn-danger");
  });

  it("Wyloguj jest jedną czerwoną (niebezpieczną) akcją na dole, a Edytuj profil tonalną w sekcji danych", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Wyloguj" })).toHaveClass("btn-danger");
    expect(within(section("profil-dane")).getByRole("button", { name: "Edytuj profil" })).toHaveClass("btn-ghost");
  });

  it("nagłówek profilu ma imię, rolę i znak Parent Verified, gdy konto jest zweryfikowane", async () => {
    fake.db.accounts.find((a) => a.id === ME).verified = true;
    await open();
    const main = within(document.querySelector(".app-main"));
    expect(main.getByText("Test Rodzic")).toBeInTheDocument();
    expect(main.getByText(/Parent Verified/)).toBeInTheDocument();
  });
});
