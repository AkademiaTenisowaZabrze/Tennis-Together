// Nowa ikona aplikacji (walizka z piłki, mięta #8EE3C8 + grafit #1F2933): zasoby Androida, aplikacja webowa i strony.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { read, trackedFiles } from "../helpers/repo.mjs";

const res = "android/app/src/main/res";
const exists = (p) => fs.existsSync(path.resolve(p));

describe("ikona Androida", () => {
  const adaptive = read(`${res}/mipmap-anydpi-v26/ic_launcher.xml`);

  it("ikona adaptacyjna ma tło, wektor znaku i warstwę monochromatyczną (motyw Androida 13+)", () => {
    expect(adaptive).toMatch(/<background android:drawable="@color\/ic_launcher_background"/);
    expect(adaptive).toMatch(/<foreground android:drawable="@drawable\/ic_launcher_foreground"/);
    expect(adaptive).toMatch(/<monochrome android:drawable="@drawable\/ic_launcher_monochrome"/);
    expect(read(`${res}/mipmap-anydpi-v26/ic_launcher_round.xml`)).toMatch(/<monochrome/);
  });

  it("tło ikony to mięta z palety marki", () => {
    expect(read(`${res}/values/ic_launcher_background.xml`)).toMatch(/#8EE3C8/i);
  });

  it("stare pliki ikony, które przesłaniałyby nowy wektor, zostały usunięte", () => {
    // drawable-v24 ma pierwszeństwo nad drawable na Androidzie 7+, więc stary znak by "wygrał"
    expect(exists(`${res}/drawable-v24/ic_launcher_foreground.xml`)).toBe(false);
    expect(exists(`${res}/drawable/ic_launcher_background.xml`)).toBe(false);
    expect(exists(`${res}/drawable/ic_launcher_foreground.xml`)).toBe(true);
    expect(exists(`${res}/drawable/ic_launcher_monochrome.xml`)).toBe(true);
  });

  it("PNG launchera istnieją we wszystkich gęstościach", () => {
    for (const d of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
      for (const n of ["ic_launcher", "ic_launcher_round", "ic_launcher_foreground"]) {
        expect(exists(`${res}/mipmap-${d}/${n}.png`), `${d}/${n}`).toBe(true);
      }
    }
  });

  it("manifest używa ikony i ikony okrągłej", () => {
    const m = read("android/app/src/main/AndroidManifest.xml");
    expect(m).toMatch(/android:icon="@mipmap\/ic_launcher"/);
    expect(m).toMatch(/android:roundIcon="@mipmap\/ic_launcher_round"/);
  });

  it("warstwa monochromatyczna jest obsługiwana przez wersję SDK (compileSdk 33 lub wyższa)", () => {
    expect(Number(/compileSdkVersion = (\d+)/.exec(read("android/variables.gradle"))[1])).toBeGreaterThanOrEqual(33);
  });
});

describe("ikona aplikacji webowej i strony", () => {
  it("favicony i ikony PWA są w public/ i w docs/", () => {
    for (const f of ["favicon.ico", "favicon.svg", "apple-touch-icon.png"]) {
      expect(exists(`public/${f}`), `public/${f}`).toBe(true);
      expect(exists(`docs/${f}`), `docs/${f}`).toBe(true);
    }
    expect(exists("public/icon-192.png") && exists("public/icon-512.png")).toBe(true);
  });

  it("index.html aplikacji linkuje ikony przez %BASE_URL% (aplikacja stoi w podkatalogu /app/)", () => {
    const h = read("index.html");
    expect(h).toMatch(/rel="icon" href="%BASE_URL%favicon\.ico"/);
    expect(h).toMatch(/rel="icon" href="%BASE_URL%favicon\.svg"/);
    expect(h).toMatch(/rel="apple-touch-icon" href="%BASE_URL%apple-touch-icon\.png"/);
    expect(h).not.toMatch(/href="\/icon-192\.png"/);
  });

  it("kolor paska przeglądarki zależy od motywu telefonu (jasny i ciemny)", () => {
    const h = read("index.html");
    expect(h).toMatch(/theme-color" content="#[0-9a-f]{6}" media="\(prefers-color-scheme: light\)"/i);
    expect(h).toMatch(/theme-color" content="#[0-9a-f]{6}" media="\(prefers-color-scheme: dark\)"/i);
  });

  it("manifest PWA ma miętowy kolor motywu i ikony 192 oraz 512", () => {
    const v = read("vite.config.js");
    expect(v).toMatch(/theme_color: "#8ee3c8"/i);
    expect(v).toMatch(/icon-192\.png/);
    expect(v).toMatch(/icon-512\.png/);
  });

  it("strony pomocnicze (poza 404 i szablonem maila) mają favicon", () => {
    const pages = trackedFiles().filter((f) => /^docs\/[^/]+\.html$/.test(f) && !/404|szablon/.test(f));
    expect(pages.length).toBeGreaterThanOrEqual(6);
    for (const f of pages) expect(read(f), f).toMatch(/rel="icon" href="favicon\.svg"/);
  });
});
