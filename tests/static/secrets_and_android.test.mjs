// Sekrety w repozytorium oraz bezpieczeństwo aplikacji na Androida.
import { describe, it, expect } from "vitest";
import { read, exists, trackedTextFiles, trackedFiles, lineOf } from "../helpers/repo.mjs";
import { itKnown } from "../helpers/known.js";

// Wzorce kluczy i haseł. Klucze PUBLICZNE z założenia (publishable, Firebase web) są na liście dozwolonych.
const SECRET_PATTERNS = [
  ["klucz sekretny Supabase", /sb_secret_[A-Za-z0-9_-]{10,}/],
  ["token JWT (service_role lub anon w formie eyJ...)", /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
  ["klucz prywatny", /-----BEGIN (RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----\s*(\n)?[A-Za-z0-9+/=]{60,}/],
  ["pole private_key w pliku konta usługi", /"private_key"\s*:\s*"-----BEGIN/],
  ["token GitHub", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["token GitHub (fine-grained)", /github_pat_[A-Za-z0-9_]{30,}/],
  ["token Slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["klucz AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["hasło wpisane w kodzie", /\b(password|passwd|haslo|hasło)\s*[:=]\s*["'][^"'\s]{6,}["']/i],
  ["klucz Stripe", /\b(sk|rk)_live_[A-Za-z0-9]{10,}/],
];

const ALLOWED = [
  // klucz web Firebase jest publiczny z założenia (identyfikuje projekt, nie daje dostępu)
  { file: "src/lib/firebaseWebConfig.js", pattern: /AIza/ },
];

describe("sekrety w śledzonych plikach", () => {
  const files = trackedTextFiles();

  it("repozytorium śledzi sensowną liczbę plików tekstowych", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const [name, re] of SECRET_PATTERNS) {
    it(`brak: ${name}`, () => {
      const hits = [];
      for (const f of files) {
        let text;
        try {
          text = read(f);
        } catch {
          continue;
        }
        const m = re.exec(text);
        if (m) hits.push(`${f}:${lineOf(text, m.index)}`);
      }
      expect(hits).toEqual([]);
    });
  }

  it("klucz Google API (AIza...) występuje wyłącznie w publicznej konfiguracji Firebase", () => {
    const hits = [];
    for (const f of files) {
      let text;
      try {
        text = read(f);
      } catch {
        continue;
      }
      if (/AIza[0-9A-Za-z_-]{30,}/.test(text) && !ALLOWED.some((a) => a.file === f)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });

  it("w kodzie klienta (src, docs, android) nie ma klucza service_role", () => {
    const hits = [];
    for (const f of files.filter((x) => /^(src|docs|android)\//.test(x))) {
      let text;
      try {
        text = read(f);
      } catch {
        continue;
      }
      if (/service_role/i.test(text) && /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"']{20,}/.test(text)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });

  it("jedyny klucz Supabase w kodzie klienta to klucz publishable", () => {
    const cfg = read("docs/config.js");
    expect(cfg).toMatch(/supabaseAnonKey:\s*"sb_publishable_/);
    expect(cfg).not.toMatch(/sb_secret_/);
  });

  it("plik .env i pliki z kluczami nie są śledzone przez git", () => {
    const bad = trackedFiles().filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".example"));
    expect(bad).toEqual([]);
    const bad2 = trackedFiles().filter((f) => /google-services\.json$|serviceAccount|\.pem$|\.p12$|keystore\.properties$/i.test(f));
    expect(bad2).toEqual([]);
  });

  it(".gitignore chroni .env, klucze produkcyjne i google-services.json", () => {
    const g = read(".gitignore");
    for (const needle of [".env", "keystore.properties", "google-services.json", "*.keystore"]) expect(g, needle).toContain(needle);
  });

  it("Edge Functions czytają klucze z środowiska, nie z kodu", () => {
    for (const f of ["supabase/functions/notify-tournament/index.ts", "supabase/functions/pzt-player-lookup/index.ts"]) {
      const t = read(f);
      expect(t, f).not.toMatch(/sb_secret_|eyJ[A-Za-z0-9_-]{30,}/);
    }
    expect(read("supabase/functions/notify-tournament/index.ts")).toMatch(/Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  });

  it("w kodzie klienta nie ma logowania tokenów i haseł do konsoli", () => {
    const hits = [];
    for (const f of files.filter((x) => /^src\//.test(x))) {
      const t = read(f);
      const m = /console\.(log|info|debug)\([^)]*\b(token|password|haslo|session)\b/i.exec(t);
      if (m) hits.push(`${f}:${lineOf(t, m.index)}`);
    }
    expect(hits).toEqual([]);
  });
});

describe("Android: manifest i konfiguracja", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");

  it("aplikacja prosi wyłącznie o uprawnienie INTERNET", () => {
    const perms = [...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
    expect(perms).toEqual(["android.permission.INTERNET"]);
  });

  it("ruch nieszyfrowany (HTTP) jest wyłączony", () => {
    expect(manifest).not.toMatch(/usesCleartextTraffic="true"/);
    expect(manifest).not.toMatch(/networkSecurityConfig/); // nie osłabiamy domyślnych zasad
  });

  it("aplikacja nie jest oznaczona jako debuggable", () => {
    expect(manifest).not.toMatch(/android:debuggable="true"/);
  });

  it("tylko główna aktywność jest eksportowana", () => {
    const comps = [...manifest.matchAll(/<(activity|service|receiver|provider)\b[^>]*>/g)].map((m) => m[0]);
    for (const c of comps) {
      const exported = /android:exported="(true|false)"/.exec(c)?.[1];
      expect(exported, `brak jawnego exported: ${c.slice(0, 80)}`).toBeDefined();
      if (exported === "true") expect(c).toMatch(/MainActivity/);
    }
  });

  it("FileProvider nie jest eksportowany", () => {
    expect(manifest).toMatch(/FileProvider[\s\S]*?android:exported="false"/);
  });

  it("kopie zapasowe są wyłączone (allowBackup=false), żeby sesja logowania nie trafiała do backupu", () => {
    expect(manifest).toMatch(/android:allowBackup="false"/);
  });

  it("Capacitor nie ładuje zdalnej strony ani nie dopuszcza ruchu HTTP", () => {
    const cfg = JSON.parse(read("capacitor.config.json"));
    expect(cfg.server?.url).toBeUndefined();
    expect(cfg.server?.cleartext).toBeFalsy();
    expect(cfg.server?.allowNavigation ?? []).not.toContain("*");
  });

  it("identyfikator aplikacji jest stały", () => {
    expect(JSON.parse(read("capacitor.config.json")).appId).toBe("pl.tennistogether.app");
  });

  it("wersja aplikacji (versionCode) pochodzi z numeru przebiegu CI, więc zawsze rośnie", () => {
    const g = read("android/app/build.gradle");
    expect(g).toMatch(/appVersionCode/);
    expect(g).toMatch(/versionCode appVersionCode/);
  });

  it("budowanie wydania używa osobnego klucza produkcyjnego (nie debug)", () => {
    const g = read("android/app/build.gradle");
    expect(g).toMatch(/keystoreProperties/);
    expect(g).toMatch(/signingConfigs\s*{[\s\S]*release/);
  });

  itKnown("F16", "APK rozdawane testerom nie jest podpisane publicznym kluczem debug (każdy mógłby wydać podrobioną aktualizację)", () => {
    expect(trackedFiles()).not.toContain("android/app/debug.keystore");
  });

  it("w repozytorium nie ma klucza produkcyjnego", () => {
    const keys = trackedFiles().filter((f) => /\.(keystore|jks)$/.test(f) && !/debug\.keystore$/.test(f));
    expect(keys).toEqual([]);
  });
});
