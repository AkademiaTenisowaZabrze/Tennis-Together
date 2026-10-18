// Tokeny designu (src/styles/tokens.css): obecność wymaganych zmiennych i kontrast WCAG w jasnym i ciemnym motywie.
import { describe, it, expect } from "vitest";
import { read } from "../helpers/repo.mjs";

const css = read("src/styles/tokens.css");

// Wyciąga deklaracje `--nazwa: wartość;` z bloku o podanym selektorze (pierwsze wystąpienie).
function block(selectorRe) {
  const m = selectorRe.exec(css);
  if (!m) throw new Error(`brak bloku ${selectorRe}`);
  let i = css.indexOf("{", m.index) + 1;
  let depth = 1;
  const start = i;
  while (depth && i < css.length) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") depth--;
    i++;
  }
  const body = css.slice(start, i - 1);
  const vars = {};
  for (const d of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) vars[d[1]] = d[2].trim();
  return vars;
}

const light = block(/^:root \{/m);
const dark = { ...light, ...block(/:root\[data-theme="dark"\] \{/) };
const darkMedia = (() => {
  const m = /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{/.exec(css);
  expect(m, "blok ciemny z media query").toBeTruthy();
  return block(/:root:not\(\[data-theme="light"\]\) \{/);
})();

const hex = (v) => {
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) throw new Error(`oczekiwano koloru #rrggbb, jest: ${v}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
};
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// color-mix(in srgb, A p%, B): zwykła interpolacja w sRGB, tak jak liczy przeglądarka
const mix = (a, pct, b) => a.map((v, i) => Math.round((v * pct) / 100 + b[i] * (1 - pct / 100)));

describe("tokeny: komplet zmiennych ze standardu", () => {
  const required = ["bg", "panel", "text", "muted", "line", "accent", "on-accent", "accent-ink", "ok", "warn", "err", "r-lg", "r-card", "r-md", "r-sm", "sp-1", "sp-2", "sp-3", "sp-4", "sp-5", "touch", "ease", "surface", "surface-2", "tonal", "glass", "glass-line", "elev-1", "sat", "sab"];
  it("jasny motyw (domyślny :root) definiuje wszystkie tokeny", () => {
    for (const k of required) expect(light[k], `--${k}`).toBeTruthy();
  });
  it("cel dotyku to co najmniej 44 px, a promienie zgodne ze standardem", () => {
    expect(parseInt(light.touch)).toBeGreaterThanOrEqual(44);
    expect([light["r-lg"], light["r-card"], light["r-md"], light["r-sm"]]).toEqual(["28px", "20px", "16px", "12px"]);
  });
  it("mięta i grafit to kolory z ikony aplikacji", () => {
    expect(light.accent.toLowerCase()).toBe("#8ee3c8");
    expect(light["on-accent"].toLowerCase()).toBe("#1f2933");
  });
  it("ciemny motyw jest zdefiniowany dwa razy: według telefonu i ręcznie, z tymi samymi kolorami", () => {
    for (const k of ["bg", "panel", "text", "muted", "line", "accent-ink", "ok", "warn", "err"]) {
      expect(darkMedia[k], `--${k}`).toBe(dark[k]);
    }
  });
  it("starsze nazwy zmiennych są aliasami nowych (bez własnych kolorów)", () => {
    for (const [old, now] of [["color-bg", "bg"], ["color-text", "text"], ["color-text-muted", "muted"], ["color-primary", "accent"], ["color-primary-text", "on-accent"]]) {
      expect(css).toContain(`--${old}: var(--${now});`);
    }
  });
  it("czcionka jest systemowa (bez Google Fonts)", () => {
    expect(light.font).toMatch(/system-ui/);
    expect(read("index.html")).not.toMatch(/fonts\.googleapis/);
  });
});

describe("tokeny: kontrast tekstu co najmniej 4,5:1", () => {
  for (const [name, t] of [["jasny", light], ["ciemny", dark]]) {
    const c = (k) => hex(t[k]);
    it(`${name}: tekst i tekst pomocniczy na tle i na karcie`, () => {
      for (const bg of ["bg", "panel"]) {
        expect(contrast(c("text"), c(bg)), `text na ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c("muted"), c(bg)), `muted na ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${name}: tekst grafitowy na mięcie (przycisk główny) i na tonalnym tle`, () => {
      expect(contrast(c("on-accent"), c("accent"))).toBeGreaterThanOrEqual(7);
      const pct = name === "jasny" ? 30 : 20;
      const tonal = mix(c("accent"), pct, c("panel"));
      expect(contrast(c("text"), tonal), "text na tonal").toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: mięta jako tekst/ikona (accent-ink), kolory stanów i błędu na karcie`, () => {
      for (const k of ["accent-ink", "ok", "warn", "err"]) {
        expect(contrast(c(k), c("panel")), `${k} na panel`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c(k), c("bg")), `${k} na bg`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it("surowa mięta NIE nadaje się na tekst w jasnym motywie (dlatego jest accent-ink)", () => {
    expect(contrast(hex(light.accent), hex(light.panel))).toBeLessThan(3);
  });
});

describe("tokeny: dostępność", () => {
  it("wysoki kontrast wzmacnia obrysy i zamienia szkło na tło jednolite", () => {
    expect(css).toMatch(/@media \(prefers-contrast: more\)[\s\S]*--muted: var\(--text\)/);
    expect(css).toMatch(/@media \(prefers-contrast: more\), \(prefers-reduced-transparency: reduce\)[\s\S]*\.glass[\s\S]*background: var\(--panel\) !important/);
  });
  it("animacje wyłączane przez prefers-reduced-motion, pola mają 16 px, fokus jest widoczny", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*transition-duration: 0\.001ms !important/);
    expect(css).toMatch(/input,\s*select,\s*textarea \{\s*font-size: 16px/);
    expect(css).toMatch(/:focus-visible \{\s*outline: 2\.5px solid/);
  });
});
