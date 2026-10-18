# Tennis Together

Aplikacja do organizacji wspólnych wyjazdów na turnieje tenisowe — przejazdy,
noclegi i grupy wyjazdowe dla zawodników i rodziców.

Pełny plan, decyzje i model danych: [PLAN.md](PLAN.md).
Założenia funkcjonalne: [docs/ATZ_Aplikacja_Zawodnicy_Rodzice_Zalozenia.docx](docs/ATZ_Aplikacja_Zawodnicy_Rodzice_Zalozenia.docx).

## Stos technologiczny

- **Frontend:** React + Vite + Capacitor (Android + PWA)
- **Backend:** Supabase (Postgres + PostGIS + Auth + Realtime)

## Wygląd

Nowy wygląd (mięta i grafit, zestaw ikon, jasny i ciemny motyw) opisuje [PLAN_NOWY_WYGLAD.md](PLAN_NOWY_WYGLAD.md). Tokeny są w `src/styles/tokens.css`, ikony w `src/components/icons.js`.

## Uruchomienie lokalne

```bash
npm install
cp .env.example .env   # wypełnij danymi swojego projektu Supabase
npm run dev
```

Aplikacja wystartuje na http://localhost:3100.

Bez konta i bez połączenia z bazą (atrapa z wymyślonym użytkownikiem): `npm run dev:demo`.

Testy: `npm test` (opis w [tests/README.md](tests/README.md)).

## Baza danych

Schemat startowy jest w `supabase/migrations/0001_init.sql` — wklej go w
Supabase SQL Editor przy tworzeniu nowego projektu (region UE/Frankfurt).

## Android

```bash
npm run build
npx cap sync android
npx cap open android
```

Budowanie podpisanego APK odbywa się automatycznie w GitHub Actions
(`.github/workflows/android-build.yml`) po wypchnięciu na główną gałąź.
