// Profil: usunięcie konta i danych (RODO art. 17), po stronie aplikacji. Samo kasowanie robi funkcja bazy
// delete_my_account() (migracja 0048, testy w tests/db/account_deletion.test.mjs).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/supabase.js", async () => await import("../helpers/fakeSupabase.js"));
import { fake, ME } from "../helpers/fakeSupabase.js";
import App from "../../src/App.jsx";
import { renderWithApp } from "../helpers/render.jsx";

beforeEach(() => fake.reset());
afterEach(cleanup);

async function openProfile() {
  const user = userEvent.setup();
  renderWithApp(<App />);
  const nav = await screen.findByRole("navigation");
  await user.click(within(nav).getByRole("link", { name: "Profil" }));
  await screen.findByRole("heading", { name: "Profil" });
  return user;
}

describe("usuwanie konta", () => {
  it("przycisk 'Usuń konto' tylko otwiera ostrzeżenie, niczego jeszcze nie kasuje", async () => {
    const user = await openProfile();
    await user.click(await screen.findByRole("button", { name: "Usuń konto" }));
    expect(screen.getByText("Usunąć konto?")).toBeInTheDocument();
    expect(fake.log.some((l) => l.op === "rpc" && l.name === "delete_my_account")).toBe(false);
  });

  it("potwierdzenie jest nieaktywne, dopóki nie wpiszesz słowa USUŃ", async () => {
    const user = await openProfile();
    await user.click(await screen.findByRole("button", { name: "Usuń konto" }));
    const confirm = screen.getByRole("button", { name: "Usuń konto na zawsze" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Potwierdzenie usunięcia konta"), "usuń");
    expect(confirm).toBeEnabled();
    await user.clear(screen.getByLabelText("Potwierdzenie usunięcia konta"));
    await user.type(screen.getByLabelText("Potwierdzenie usunięcia konta"), "nie");
    expect(confirm).toBeDisabled();
  });

  it("potwierdzone usunięcie wywołuje funkcję bazy, czyści zdjęcie i wylogowuje", async () => {
    fake.setAvatarFiles([{ name: "avatar.jpg" }]);
    const user = await openProfile();
    await user.click(await screen.findByRole("button", { name: "Usuń konto" }));
    await user.type(screen.getByLabelText("Potwierdzenie usunięcia konta"), "USUŃ");
    await user.click(screen.getByRole("button", { name: "Usuń konto na zawsze" }));
    await vi.waitFor(() => expect(fake.log.some((l) => l.op === "rpc" && l.name === "delete_my_account")).toBe(true));
    expect(fake.log.find((l) => l.op === "storage_remove")?.payload).toEqual([`${ME}/avatar.jpg`]);
    await vi.waitFor(() => expect(fake.authCalls.some((c) => c[0] === "signOut")).toBe(true));
  });

  it("błąd bazy: komunikat, konto nie jest wylogowane, można spróbować ponownie", async () => {
    fake.rpcHandlers.delete_my_account = () => ({ data: null, error: { message: "boom" } });
    const user = await openProfile();
    await user.click(await screen.findByRole("button", { name: "Usuń konto" }));
    await user.type(screen.getByLabelText("Potwierdzenie usunięcia konta"), "USUŃ");
    await user.click(screen.getByRole("button", { name: "Usuń konto na zawsze" }));
    expect(await screen.findByText(/Nie udało się usunąć konta/)).toBeInTheDocument();
    expect(fake.authCalls.some((c) => c[0] === "signOut")).toBe(false);
    expect(screen.getByRole("button", { name: "Usuń konto na zawsze" })).toBeEnabled();
  });

  it("anulowanie zamyka ostrzeżenie bez żadnych zmian", async () => {
    const user = await openProfile();
    await user.click(await screen.findByRole("button", { name: "Usuń konto" }));
    await user.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(screen.queryByText("Usunąć konto?")).not.toBeInTheDocument();
    expect(fake.log.some((l) => l.op === "rpc" && l.name === "delete_my_account")).toBe(false);
  });
});
