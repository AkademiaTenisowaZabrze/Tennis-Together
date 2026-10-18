// Ikony aplikacji w działaniu: komponenty Icon/TileIcon, zakładki, ekran Start i szuflada.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/supabase.js", async () => await import("../helpers/fakeSupabase.js"));
import { fake } from "../helpers/fakeSupabase.js";
import App from "../../src/App.jsx";
import { Icon, InlineIcon, TileIcon, renderIcon } from "../../src/components/Icon.jsx";
import { ICONS_A, ICONS_B } from "../../src/components/icons.js";
import { renderWithApp } from "../helpers/render.jsx";
import { tabsNav, openDrawer } from "../helpers/nav.js";

beforeEach(() => {
  fake.reset();
  localStorage.clear();
});
afterEach(cleanup);

describe("komponenty ikon", () => {
  it("Icon rysuje ścieżkę wariantu A, a z variant=B wariant B; kolor z currentColor", () => {
    const { container, rerender } = render(<Icon name="car" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg.querySelector("path")).toHaveAttribute("d", ICONS_A.car);
    expect(svg.querySelector("path")).toHaveAttribute("fill-rule", "evenodd");
    rerender(<Icon name="car" variant="B" />);
    expect(container.querySelector("path")).toHaveAttribute("d", ICONS_B.car);
  });

  it("ikona ozdobna jest ukryta przed czytnikiem, a z title ma nazwę", () => {
    const { container, rerender } = render(<Icon name="home" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    rerender(<Icon name="home" title="Strona główna" />);
    expect(screen.getByRole("img", { name: "Strona główna" })).toBeInTheDocument();
  });

  it("nieznana nazwa nie psuje ekranu (nic nie rysuje)", () => {
    const { container } = render(<Icon name="nie-ma-takiej" />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("InlineIcon ma 17 px i wyrównanie do linii tekstu", () => {
    const { container } = render(<InlineIcon name="pin" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "17");
    expect(svg).toHaveClass("inline-icon");
  });

  it("TileIcon to miętowy kafelek z promieniem 5,25 i grafitowym znakiem w skali 62%", () => {
    const { container } = render(<TileIcon name="bed" />);
    const rect = container.querySelector("rect");
    expect(rect).toHaveAttribute("fill", "#8EE3C8");
    expect(rect).toHaveAttribute("rx", "5.25");
    expect(container.querySelector("g")).toHaveAttribute("transform", "translate(4.56 4.56) scale(0.62)");
    expect(container.querySelector("path")).toHaveAttribute("fill", "#1F2933");
  });

  it("renderIcon: klucz daje ikonę, zwykły tekst zostaje tekstem", () => {
    const { container } = render(
      <div>
        {renderIcon("star")}
        {renderIcon("•")}
      </div>,
    );
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(container).toHaveTextContent("•");
  });
});

describe("ikony w aplikacji", () => {
  it("każda z czterech zakładek ma ikonę SVG z zestawu, a nie emoji", async () => {
    renderWithApp(<App />);
    const nav = await tabsNav();
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(4);
    const paths = links.map((a) => a.querySelector("svg path")?.getAttribute("d"));
    expect(paths).toEqual([ICONS_A.home, ICONS_A.trophy, ICONS_A.car, ICONS_A.chat]);
  });

  it("ekran Start: wiersze Transport i Nocleg mają kafelki z ikonami, a „Załatwiony” znacznik check", async () => {
    fake.rpcHandlers.trip_arrangements = () => ({
      data: [{ trip_id: "trip-me-1", ride_status: "arranged", lodging_status: "none" }],
      error: null,
    });
    renderWithApp(<App />);
    const pill = (await screen.findByText(/Transport:/)).closest(".status-pill");
    expect(pill.querySelector("svg rect")).toBeTruthy();
    expect(pill.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
    expect(pill).toHaveTextContent("Transport: Załatwiony");
    expect(pill.textContent).not.toMatch(/✅|🚗/);
  });

  it("szuflada: Moje wyjazdy i Profil mają ikony SVG z zestawu", async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    const drawer = await openDrawer(user);
    const my = within(drawer).getByRole("link", { name: /Moje wyjazdy/ });
    expect(my.querySelector(".ic svg path")).toHaveAttribute("d", ICONS_A.route);
    const profile = within(drawer).getByRole("link", { name: /Profil i zawodnicy/ });
    expect(profile.querySelector(".ic svg path")).toHaveAttribute("d", ICONS_A.user);
  });
});
