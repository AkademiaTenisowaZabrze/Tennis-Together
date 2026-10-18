// Wiadomości w nowym wyglądzie: pusty stan jako karta, lista rozmów, pole pisania.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/supabase.js", async () => await import("../helpers/fakeSupabase.js"));
import { fake } from "../helpers/fakeSupabase.js";
import App from "../../src/App.jsx";
import { renderWithApp } from "../helpers/render.jsx";
import { tabsNav } from "../helpers/nav.js";

beforeEach(() => {
  fake.reset();
  localStorage.clear();
});
afterEach(cleanup);

describe("Wiadomości", () => {
  it("bez rozmów pokazuje pusty stan w karcie z wyjaśnieniem", async () => {
    fake.db.conversations = [];
    const user = userEvent.setup();
    renderWithApp(<App />);
    await user.click(within(await tabsNav()).getByRole("link", { name: /Wiadomości/ }));
    const empty = await screen.findByText(/Nie masz jeszcze żadnej rozmowy/);
    expect(empty.closest(".empty")).toBeTruthy();
  });
});
