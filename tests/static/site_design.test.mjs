// Strona (docs/*.html) w nowym wyglądzie: wspólne tokeny z aplikacji, bez Google Fonts i starej limonki,
// poprawny szkielet HTML (testerzy.html wcześniej nie miał doctype/charset/viewport).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { read, filesUnder } from "../helpers/repo.mjs";

const PAGES = filesUnder("docs", /\.html$/).filter((f) => !/szablon-maila/.test(f));
const css = read("docs/site.css");
const appTokens = read("src/styles/tokens.css");

describe("docs/site.css = tokeny aplikacji", () => {
  it.each(["--accent: #8ee3c8", "--on-accent: #1f2933", "--accent-ink: #0f6b57", "--bg: #f3f4f7", "--text: #1f2933"])(
    "jasny motyw ma %s tak samo jak aplikacja",
    (decl) => {
      expect(css).toContain(decl);
      expect(appTokens).toContain(decl);
    },
  );

  it("ciemny motyw (według urządzenia) ma te same kolory co aplikacja", () => {
    expect(css).toMatch(/prefers-color-scheme: dark/);
    for (const decl of ["--bg: #12161c", "--panel: #1b212a", "--text: #e8ecf1", "--accent-ink: #8ee3c8"]) {
      expect(css).toContain(decl);
      expect(appTokens).toContain(decl);
    }
  });

  it("zachowuje stare nazwy zmiennych jako aliasy, żeby style stron nadal działały", () => {
    for (const name of ["--card-border", "--text-muted", "--primary", "--primary-text", "--secondary", "--verified", "--bg-elevated"]) {
      expect(css).toContain(`${name}:`);
    }
  });

  it("ma obsługę wysokiego kontrastu, focus i ograniczenia animacji", () => {
    expect(css).toMatch(/prefers-contrast: more/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });
});

describe.each(PAGES)("strona %s", (file) => {
  const html = read(file);

  it("ma doctype, język, kodowanie UTF-8 i viewport", () => {
    expect(html.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
    expect(html).toMatch(/<html lang="pl"/);
    expect(html).toMatch(/<meta charset="utf-8"/i);
    expect(html).toMatch(/name="viewport"/);
  });

  it("używa wspólnego arkusza site.css", () => {
    expect(html).toMatch(/href="(\/Tennis-Together\/)?site\.css"/);
  });

  it("nie ładuje Google Fonts i nie ma starej limonki ani emoji 🎾 jako logo", () => {
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(html).not.toMatch(/#d4ff00/i);
    expect(html).not.toMatch(/🎾/);
  });

  it("nie ma własnego bloku :root z kolorami (kolory są we wspólnym arkuszu)", () => {
    expect(html).not.toMatch(/:root\s*\{[^}]*--bg:/);
  });
});

describe("strona główna", () => {
  const html = read("docs/index.html");

  it("prowadzi do aplikacji i do dokumentów, a pliki, do których linkuje, istnieją", () => {
    for (const href of ["app/", "dokumentacja.html", "testerzy.html", "regulamin.html", "polityka-prywatnosci.html"]) {
      expect(html).toContain(`href="${href}"`);
      if (href !== "app/") expect(fs.existsSync(`docs/${href}`)).toBe(true);
    }
  });

  it("pokazuje nową ikonę (SVG), a nie starą niebieską", () => {
    expect(html).toContain('src="favicon.svg"');
    expect(fs.existsSync("docs/app-icon-source.png")).toBe(false);
  });

  it("ma opis dla wyszukiwarek i opisuje cztery funkcje", () => {
    expect(html).toMatch(/<meta name="description"/);
    for (const t of ["Turnieje", "Przejazdy", "Noclegi", "Rozmowy"]) expect(html).toContain(`<h2>${t}</h2>`);
  });
});

describe("szablon maila z potwierdzeniem", () => {
  const html = read("docs/szablon-maila-potwierdzenie.html");
  it("używa kolorów i ikony nowej marki, bez emoji 🎾 i bez starej czerwieni przycisku", () => {
    expect(html).toContain("#8ee3c8");
    expect(html).toMatch(/apple-touch-icon\.png/);
    expect(html).not.toMatch(/🎾|#ff5e3a/i);
    expect(html).toContain("{{ .ConfirmationURL }}");
  });
});
