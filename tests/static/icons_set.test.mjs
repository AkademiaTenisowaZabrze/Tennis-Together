// Zestaw ikon aplikacji (koncepcja A "Szew" + B "Linia", plik tennis-together-ikony.md): komplet kluczy,
// poprawne ścieżki i brak emoji tam, gdzie mają być ikony (emoji różnią się między telefonami i nie pasują do marki).
import { describe, it, expect } from "vitest";
import { read, filesUnder } from "../helpers/repo.mjs";
import { ICONS_A, ICONS_B } from "../../src/components/icons.js";

const KEYS = ["home", "trophy", "car", "bed", "route", "chat", "user", "users", "ball", "luggage", "pin", "calendar", "check", "star", "shield", "wallet", "nofee", "book", "bug", "document", "lock", "bell", "handshake", "phone", "keypad", "camera", "hourglass", "warning", "mail", "flask", "plus", "close", "arrow-left"];

describe("zestaw ikon", () => {
  it("A i B mają te same 33 klucze z mapy ikon", () => {
    expect(Object.keys(ICONS_A).sort()).toEqual([...KEYS].sort());
    expect(Object.keys(ICONS_B).sort()).toEqual([...KEYS].sort());
  });

  it.each(KEYS)("ikona %s: ścieżki są zamknięte, zaczynają się od M i mieszczą się w siatce 24 x 24 (z tolerancją 1 px: rękawy uścisku dłoni wychodzą poza krawędź)", (k) => {
    for (const set of [ICONS_A, ICONS_B]) {
      const d = set[k];
      expect(d).toMatch(/^M[\d. -]+/);
      expect(d.trim().endsWith("Z")).toBe(true);
      const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
      expect(Math.min(...nums)).toBeGreaterThanOrEqual(-1);
      expect(Math.max(...nums)).toBeLessThanOrEqual(25);
    }
  });

  it("żadne dwie ikony zestawu A nie mają tej samej ścieżki", () => {
    expect(new Set(Object.values(ICONS_A)).size).toBe(KEYS.length);
  });
});

describe("emoji zastąpione ikonami", () => {
  const files = filesUnder("src", /\.(jsx|js)$/).filter((f) => !/src[\\/]demo[\\/]/.test(f) && !/calendarExport/.test(f) && !/icons\.js$/.test(f));
  const REPLACED = ["🎾", "🚗", "🏨", "🏠", "💬", "✅", "📍", "⭐", "🛡", "💰", "📅", "🧳", "🏆", "👤", "💚", "📖", "🐞", "📄", "🔒", "🔔", "🤝", "📱", "🔢", "📷", "⏳", "⚠", "📬", "🧪", "✕", "＋"];

  it("w kodzie ekranów nie zostało żadne z zamienionych emoji", () => {
    const left = [];
    for (const f of files) {
      const t = read(f)
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      for (const e of REPLACED) if (t.includes(e)) left.push(`${f}: ${e}`);
    }
    expect(left).toEqual([]);
  });

  it("zakładki używają komponentu Icon, a stara ikona liniowa TabIcon została usunięta", () => {
    const shell = read("src/components/Shell.jsx");
    expect(shell).toMatch(/<Icon name=\{t\.icon\}/);
    expect(shell).not.toMatch(/TabIcon|ICON_PATHS/);
  });

  it("klucze ikon pasują do mapy: zakładki home/trophy/car/chat, hub bed/route, szybkie akcje ball/car", () => {
    const shell = read("src/components/Shell.jsx");
    for (const k of ["home", "trophy", "car", "chat"]) expect(shell).toContain(`icon: "${k}"`);
    expect(shell).toMatch(/id: "trip", icon: "ball"/);
    expect(shell).toMatch(/id: "offer", icon: "car"/);
    const hub = read("src/pages/TripsHub.jsx");
    for (const k of ["car", "bed", "route"]) expect(hub).toContain(`icon: "${k}"`);
  });
});
