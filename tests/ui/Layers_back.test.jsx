// Mechanizm nakładek i przycisk "wstecz" w Androidzie (src/lib/layers.js): kolejność zamykania warstw.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let backHandler = null;
const exitApp = vi.fn();
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (name, cb) => {
      if (name === "backButton") backHandler = cb;
      return { remove: vi.fn() };
    }),
    exitApp: (...a) => exitApp(...a),
  },
}));

import { useLayer, closeLayersThen, closeTopLayer, layerCount, initBackButton } from "../../src/lib/layers.js";

function Layer({ name, log }) {
  const [open, setOpen] = useState(false);
  useLayer(open, () => {
    log.push(`zamknięto ${name}`);
    setOpen(false);
  });
  return (
    <div>
      <button onClick={() => setOpen(true)}>otwórz {name}</button>
      <button onClick={() => setOpen(false)}>zamknij {name}</button>
      {open && <p>nakładka {name}</p>}
    </div>
  );
}

beforeEach(() => {
  backHandler = null;
  exitApp.mockClear();
});
afterEach(() => cleanup());

describe("stos nakładek", () => {
  it("otwarcie dokłada wpis historii, a zamknięcie przyciskiem zdejmuje go z powrotem", async () => {
    const user = userEvent.setup();
    const log = [];
    render(<Layer name="A" log={log} />);
    const before = window.history.length;
    await user.click(screen.getByText("otwórz A"));
    expect(layerCount()).toBe(1);
    expect(window.history.length).toBe(before + 1);
    expect(window.history.state?.layer).toBe(1);
    await user.click(screen.getByText("zamknij A"));
    await waitFor(() => expect(window.history.state?.layer).toBeUndefined());
    expect(layerCount()).toBe(0);
  });

  it("wstecz zamyka najwyższą nakładkę, kolejne wstecz następną (od góry)", async () => {
    const user = userEvent.setup();
    const log = [];
    render(<><Layer name="A" log={log} /><Layer name="B" log={log} /></>);
    await user.click(screen.getByText("otwórz A"));
    await user.click(screen.getByText("otwórz B"));
    expect(layerCount()).toBe(2);
    window.history.back();
    await waitFor(() => expect(log).toEqual(["zamknięto B"]));
    expect(screen.queryByText("nakładka B")).not.toBeInTheDocument();
    expect(screen.getByText("nakładka A")).toBeInTheDocument();
    window.history.back();
    await waitFor(() => expect(log).toEqual(["zamknięto B", "zamknięto A"]));
    expect(layerCount()).toBe(0);
  });

  it("closeTopLayer zwraca false, gdy nie ma nakładek, i true, gdy jakaś jest", async () => {
    const user = userEvent.setup();
    render(<Layer name="A" log={[]} />);
    expect(closeTopLayer()).toBe(false);
    await user.click(screen.getByText("otwórz A"));
    expect(closeTopLayer()).toBe(true);
    await waitFor(() => expect(layerCount()).toBe(0));
  });

  it("closeLayersThen wykonuje akcję dopiero po zamknięciu wszystkich nakładek, dokładnie raz", async () => {
    const user = userEvent.setup();
    const log = [];
    render(<><Layer name="A" log={log} /><Layer name="B" log={log} /></>);
    await user.click(screen.getByText("otwórz A"));
    await user.click(screen.getByText("otwórz B"));
    const fn = vi.fn(() => log.push("akcja"));
    closeLayersThen(fn);
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    expect(layerCount()).toBe(0);
    expect(log.at(-1)).toBe("akcja");
    expect(log.indexOf("zamknięto B")).toBeLessThan(log.indexOf("zamknięto A"));
  });

  it("closeLayersThen bez nakładek wykonuje akcję od razu", () => {
    const fn = vi.fn();
    closeLayersThen(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("przycisk wstecz w Androidzie (initBackButton)", () => {
  async function setup(path) {
    const goHome = vi.fn();
    const stop = initBackButton({ getPath: () => path, goHome });
    await waitFor(() => expect(backHandler).toBeTypeOf("function"));
    return { goHome, stop };
  }

  it("najpierw zamyka nakładkę, bez przechodzenia na Start i bez zamykania aplikacji", async () => {
    const user = userEvent.setup();
    const log = [];
    render(<Layer name="A" log={log} />);
    await user.click(screen.getByText("otwórz A"));
    const { goHome } = await setup("/turnieje");
    await act(async () => backHandler({ canGoBack: true }));
    await waitFor(() => expect(log).toEqual(["zamknięto A"]));
    expect(goHome).not.toHaveBeenCalled();
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("bez nakładek na ekranie innym niż Start wraca na Start", async () => {
    const { goHome } = await setup("/wyjazdy/moje");
    await act(async () => backHandler({ canGoBack: true }));
    expect(goHome).toHaveBeenCalledTimes(1);
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("na Starcie bez nakładek zamyka aplikację", async () => {
    const { goHome } = await setup("/");
    await act(async () => backHandler({ canGoBack: false }));
    expect(exitApp).toHaveBeenCalledTimes(1);
    expect(goHome).not.toHaveBeenCalled();
  });
});
