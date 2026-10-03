// Turnieje: link do strony turnieju pochodzi z bazy, więc przepuszczamy tylko http/https (audyt F18).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/supabase.js", async () => await import("../helpers/fakeSupabase.js"));
import { fake } from "../helpers/fakeSupabase.js";
import App from "../../src/App.jsx";
import { renderWithApp } from "../helpers/render.jsx";

beforeEach(() => fake.reset());
afterEach(cleanup);

async function openTournaments(urls) {
  fake.db.tournaments = urls.map((website_url, i) => ({
    id: `t-url-${i}`,
    source: "otk",
    name: `Turniej ${i}`,
    city: "Zabrze",
    category: "U12",
    starts_on: "2099-10-20",
    ends_on: "2099-10-23",
    website_url,
  }));
  const user = userEvent.setup();
  renderWithApp(<App />);
  const nav = await screen.findByRole("navigation");
  await user.click(within(nav).getByRole("link", { name: "Turnieje" }));
  await screen.findByText("Turniej 0");
  return user;
}

// Pomijamy stałe linki aplikacji (logo partnerów w stopce): interesują nas tylko adresy z bazy.
const FIXED = ["https://www.akademiatenisowazabrze.pl/", "https://www.pzt.pl/"];
const hrefsOfLinks = () =>
  screen
    .queryAllByRole("link")
    .map((a) => a.getAttribute("href"))
    .filter((h) => h && !h.startsWith("/") && !h.startsWith("#") && !FIXED.includes(h));

describe("link do strony turnieju", () => {
  it("adres https jest linkiem", async () => {
    await openTournaments(["https://www.pzt.pl/turniej/1"]);
    expect(hrefsOfLinks()).toContain("https://www.pzt.pl/turniej/1");
  });

  it("adres http też jest linkiem", async () => {
    await openTournaments(["http://example.org/x"]);
    expect(hrefsOfLinks()).toContain("http://example.org/x");
  });

  it("adresy z innym schematem (javascript:, data:, file:, vbscript:) nie trafiają do żadnego linku", async () => {
    await openTournaments(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "vbscript:msgbox(1)"]);
    const all = hrefsOfLinks();
    for (const bad of ["javascript:", "data:", "file:", "vbscript:"]) {
      expect(all.some((h) => h.toLowerCase().startsWith(bad)), bad).toBe(false);
    }
  });

  it("pusty, brakujący i nieczytelny adres nie tworzą linku", async () => {
    await openTournaments([null, "", "to nie jest adres"]);
    expect(hrefsOfLinks()).toEqual([]);
  });
});
