// Profil: lista zgód i wycofanie zgody (migracja 0046 pozwala właścicielowi zmienić tylko pole `granted`).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/supabase.js", async () => await import("../helpers/fakeSupabase.js"));
import { fake, ME } from "../helpers/fakeSupabase.js";
import App from "../../src/App.jsx";
import { renderWithApp } from "../helpers/render.jsx";

beforeEach(() => {
  fake.reset();
  fake.db.consents = [
    { id: "c-1", player_id: "pl-1", given_by_account_id: ME, consent_type: "host_family_stay", granted: true, created_at: "2099-01-01T10:00:00Z", players: { first_name: "Kuba" } },
    { id: "c-2", player_id: "pl-1", given_by_account_id: ME, consent_type: "terms", granted: false, created_at: "2098-01-01T10:00:00Z", players: { first_name: "Kuba" } },
  ];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openProfile() {
  const user = userEvent.setup();
  renderWithApp(<App />);
  const nav = await screen.findByRole("navigation");
  await user.click(within(nav).getByRole("link", { name: "Profil" }));
  await screen.findByRole("heading", { name: "Profil" });
  return user;
}

describe("zgody w profilu", () => {
  it("pokazuje udzieloną i wycofaną zgodę, a przycisk wycofania tylko przy udzielonej", async () => {
    await openProfile();
    expect(await screen.findByText(/udzielona/)).toBeInTheDocument();
    expect(screen.getByText(/wycofana/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Wycofaj" })).toHaveLength(1);
  });

  it("wycofanie zgody wysyła zmianę samego pola granted i odświeża listę", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = await openProfile();
    await user.click(await screen.findByRole("button", { name: "Wycofaj" }));
    const upd = fake.log.find((l) => l.table === "consents" && l.op === "update");
    expect(upd).toBeTruthy();
    expect(upd.payload).toEqual({ granted: false });
    await screen.findAllByText(/wycofana/);
    expect(screen.queryByRole("button", { name: "Wycofaj" })).not.toBeInTheDocument();
  });

  it("odmowa w oknie potwierdzenia nie zmienia zgody", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = await openProfile();
    await user.click(await screen.findByRole("button", { name: "Wycofaj" }));
    expect(fake.log.some((l) => l.table === "consents" && l.op === "update")).toBe(false);
    expect(screen.getByRole("button", { name: "Wycofaj" })).toBeInTheDocument();
  });

  it("błąd bazy przy wycofaniu pokazuje komunikat i zostawia zgodę udzieloną", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = await openProfile();
    fake.failNext("consents", "update", { message: "brak uprawnień", code: "42501" });
    await user.click(await screen.findByRole("button", { name: "Wycofaj" }));
    expect(await screen.findByText(/Nie udało się wycofać zgody/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wycofaj" })).toBeInTheDocument();
  });
});
