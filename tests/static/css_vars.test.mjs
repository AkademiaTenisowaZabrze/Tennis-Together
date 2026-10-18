// Ochrona strukturalna stylów: każda użyta zmienna CSS jest zdefiniowana, a tryb demo nie przecieka do zwykłego buildu.
import { describe, it, expect } from "vitest";
import { read, filesUnder } from "../helpers/repo.mjs";

const tokens = read("src/styles/tokens.css");
const defined = new Set([...tokens.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
// zmienne ustawiane lokalnie w komponentach (nie w tokens.css)
const LOCAL = new Set(["safe-area-inset-top", "safe-area-inset-bottom", "sheet-h"]);

const sources = [...filesUnder("src", /\.(jsx?|css)$/), "index.html"];

describe("zmienne CSS", () => {
  it("każda użyta var(--nazwa) jest zdefiniowana w tokens.css (albo jawnie lokalna)", () => {
    const missing = [];
    for (const f of sources) {
      const t = read(f);
      for (const m of t.matchAll(/var\(--([a-z0-9-]+)/g)) {
        if (!defined.has(m[1]) && !LOCAL.has(m[1])) missing.push(`${f}: --${m[1]}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("komponenty bazowe mają style w components.css i są importowane przez index.css", () => {
    const css = read("src/styles/components.css");
    for (const sel of [".sec ", ".sec-h", "details.sec", ".item ", ".toast", ".empty", ".btn-block", ".field"]) {
      expect(css, sel).toContain(sel);
    }
    expect(read("src/index.css")).toMatch(/@import "\.\/styles\/components\.css"/);
  });
});

describe("tryb demo", () => {
  it("atrapa bazy jest podmieniana tylko w trybie demo (vite --mode demo)", () => {
    const v = read("vite.config.js");
    expect(v).toMatch(/mode === "demo"/);
    expect(v).toMatch(/src\/demo\/demoSupabase\.js/);
  });

  it("żaden plik aplikacji (poza src/demo) nie importuje atrapy ani kodu testów", () => {
    const bad = filesUnder("src", /\.(jsx?)$/).filter((f) => !f.startsWith("src/demo/") && /tests\/|fakeSupabase/.test(read(f)));
    expect(bad).toEqual([]);
  });

  it("konfiguracja demo nie zawiera prawdziwych adresów ani kluczy", () => {
    const env = read(".env.demo");
    expect(env).toMatch(/VITE_SUPABASE_URL=http:\/\/demo\.invalid/);
    expect(env).not.toMatch(/supabase\.co|sb_publishable|service_role/i);
  });
});
