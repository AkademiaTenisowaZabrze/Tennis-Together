// Panel admina po włączeniu captchy w Supabase (2026-10-18): logowanie hasłem wymaga tokenu Turnstile.
// Bez niego Supabase odrzuca logowanie, a panel pokazywał to jako "Błędny e-mail lub hasło".
import { describe, it, expect } from "vitest";
import { read } from "../helpers/repo.mjs";

const admin = read("docs/admin.html");
const config = read("docs/config.js");

describe("panel admina: captcha przy logowaniu", () => {
  it("konfiguracja stron ma publiczny klucz witryny Turnstile (zaczyna się od 0x4)", () => {
    expect(config).toMatch(/turnstileSiteKey:\s*"0x4[A-Za-z0-9_-]{15,}"/);
  });

  it("ekran logowania ładuje skrypt Cloudflare i renderuje widżet w polu captchaBox", () => {
    expect(admin).toContain('id="captchaBox"');
    expect(admin).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
    expect(admin).toMatch(/turnstile\.render\("#captchaBox"/);
    expect(admin).toContain("window.TT_CONFIG.turnstileSiteKey");
  });

  it("logowanie dołącza captchaToken i resetuje widżet po każdej próbie (token jest jednorazowy)", () => {
    expect(admin).toMatch(/signInWithPassword\(\{[^}]*options:[^}]*captchaToken/);
    expect(admin).toMatch(/resetCaptcha\(\);\s*btn\.disabled = false/);
  });

  it("bez tokenu nie wysyła zapytania, tylko prosi o zaznaczenie captchy", () => {
    expect(admin).toMatch(/if \(captchaKey && !captchaToken\)/);
    expect(admin).toContain("Najpierw zaznacz");
  });

  it("błędy logowania są rozróżnione: captcha, limit prób, złe hasło, inne", () => {
    expect(admin).toContain("Weryfikacja „Nie jestem robotem” nie powiodła się");
    expect(admin).toContain("Zbyt wiele prób logowania");
    expect(admin).toContain("Błędny e-mail lub hasło.");
    expect(admin).toContain("Nie udało się zalogować: ");
  });
});

describe("zgodność klucza captchy: aplikacja, strona i workflow", () => {
  it("workflowy budujące aplikację przekazują ten sam klucz przez zmienną TURNSTILE_SITE_KEY", () => {
    for (const f of ["deploy-web", "android-debug-apk", "android-build"]) {
      expect(read(`.github/workflows/${f}.yml`)).toContain("VITE_TURNSTILE_SITE_KEY: ${{ vars.TURNSTILE_SITE_KEY }}");
    }
  });
});
