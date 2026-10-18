// Komponenty bazowe nowego wyglądu (src/components/ui.jsx): sekcje, sekcja rozwijana z pamięcią, wiersz, stan pusty, toast.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Section, Collapsible, ListItem, EmptyState, ToastProvider, useToast, TOAST_MS } from "../../src/components/ui.jsx";
import ErrorBox from "../../src/components/ErrorBox.jsx";
import { inputStyle, labelStyle } from "../../src/components/formStyles.js";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Section i ListItem", () => {
  it("sekcja ma nagłówek z ikoną (ukrytą przed czytnikiem) i treść", () => {
    render(<Section icon="🧳" title="Zawodnicy"><p>Kuba</p></Section>);
    const h = screen.getByRole("heading", { name: "Zawodnicy" });
    expect(h.querySelector("[aria-hidden='true']")).toHaveTextContent("🧳");
    expect(screen.getByText("Kuba")).toBeInTheDocument();
  });

  it("wiersz pokazuje tytuł, podpis i akcje po prawej", () => {
    render(<ListItem title="Turniej U12" subtitle="Warszawa"><button>Jadę</button></ListItem>);
    expect(screen.getByText("Turniej U12")).toBeInTheDocument();
    expect(screen.getByText("Warszawa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jadę" })).toBeInTheDocument();
  });
});

describe("Collapsible (sekcja rozwijana)", () => {
  const mount = (props) => render(<Collapsible id="zgody" icon="✅" title="Zgody" summary="2 udzielone" {...props}><p>Treść sekcji</p></Collapsible>);

  it("domyślnie jest zwinięta i pokazuje tytuł z podsumowaniem", () => {
    const { container } = mount();
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Zgody")).toBeInTheDocument();
    expect(screen.getByText("2 udzielone")).toBeInTheDocument();
  });

  it("można ją otworzyć domyślnie (defaultOpen)", () => {
    const { container } = mount({ defaultOpen: true });
    expect(container.querySelector("details")).toHaveAttribute("open");
  });

  it("otwarcie i zwinięcie jest zapamiętywane pod kluczem sekcji", () => {
    const { container, unmount } = mount();
    const d = container.querySelector("details");
    d.open = true;
    fireEvent(d, new Event("toggle"));
    expect(JSON.parse(localStorage.getItem("tennis-together-sections")).zgody).toBe(true);
    unmount();
    const again = mount();
    expect(again.container.querySelector("details")).toHaveAttribute("open");
    const d2 = again.container.querySelector("details");
    d2.open = false;
    fireEvent(d2, new Event("toggle"));
    expect(JSON.parse(localStorage.getItem("tennis-together-sections")).zgody).toBe(false);
  });

  it("zapamiętany stan wygrywa z defaultOpen, a różne sekcje nie wpływają na siebie", () => {
    localStorage.setItem("tennis-together-sections", JSON.stringify({ zgody: false, inna: true }));
    const { container } = mount({ defaultOpen: true });
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });

  it("uszkodzony zapis w pamięci nie psuje sekcji", () => {
    localStorage.setItem("tennis-together-sections", "{to nie jest json");
    const { container } = mount({ defaultOpen: true });
    expect(container.querySelector("details")).toHaveAttribute("open");
  });
});

describe("EmptyState", () => {
  it("pokazuje jedno zdanie i następny krok", () => {
    render(<EmptyState action={<button>Znajdź turniej</button>}>Nie masz jeszcze wyjazdu.</EmptyState>);
    expect(screen.getByText("Nie masz jeszcze wyjazdu.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Znajdź turniej" })).toBeInTheDocument();
  });
});

describe("Toast", () => {
  function Trigger({ kind }) {
    const toast = useToast();
    return <button onClick={() => toast("Zapisano zmiany", kind)}>pokaż</button>;
  }

  it("pokazuje komunikat z role=status i znika po 7 sekundach", async () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger kind="ok" /></ToastProvider>);
    fireEvent.click(screen.getByText("pokaż"));
    const t = screen.getByRole("status");
    expect(t).toHaveTextContent("Zapisano zmiany");
    expect(t).toHaveClass("ok");
    await act(async () => { vi.advanceTimersByTime(TOAST_MS - 100); });
    expect(screen.queryByRole("status")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(TOAST_MS).toBe(7000);
  });

  it("nowy komunikat zastępuje poprzedni (jeden naraz)", () => {
    function Two() {
      const toast = useToast();
      return (<><button onClick={() => toast("Pierwszy")}>a</button><button onClick={() => toast("Drugi", "err")}>b</button></>);
    }
    render(<ToastProvider><Two /></ToastProvider>);
    fireEvent.click(screen.getByText("a"));
    fireEvent.click(screen.getByText("b"));
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Drugi");
    expect(screen.getByRole("status")).toHaveClass("err");
  });

  it("bez providera useToast nic nie psuje (zwraca pustą funkcję)", async () => {
    const user = userEvent.setup();
    render(<Trigger />);
    await user.click(screen.getByText("pokaż"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("pola formularza i błędy", () => {
  it("styl pola: 16 px, min. wysokość z tokena dotyku, obrys i tło z tokenów", () => {
    expect(inputStyle.fontSize).toBe(16);
    expect(inputStyle.minHeight).toBe("var(--touch)");
    expect(inputStyle.border).toContain("var(--line)");
    expect(inputStyle.background).toBe("var(--surface)");
    expect(labelStyle.display).toBe("block");
  });

  it("ErrorBox jest ogłaszany czytnikom (role=alert) i ma tekst, a nie tylko kolor", () => {
    render(<ErrorBox>Nie udało się zapisać.</ErrorBox>);
    expect(screen.getByRole("alert")).toHaveTextContent("Nie udało się zapisać.");
  });
});
