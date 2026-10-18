# Plan wdrożenia nowego wyglądu Tennis Together

Źródła: `STANDARD_DESIGNU.txt` (v1), nowa ikona (mięta #8EE3C8 + grafit #1F2933), makiety w `PLIKI DO PROJEKTÓW\tennis-together-koncepcja`.
Decyzje Pawła (2026-10-18): przycisk główny miętowy z grafitowym tekstem; motyw domyślnie według telefonu; czcionka systemowa;
nikt jeszcze nie testuje aplikacji, więc etapy idą wprost na `main`, ale każdy musi przejść testy; zakładki pogrupowane wg UX.

## Układ nawigacji (propozycja, do akceptacji na zrzutach etapu 4)

Dolny pasek (4 cele, kciuk): **Start · Turnieje · Wyjazdy · Wiadomości**.
- **Wyjazdy** to jedno miejsce z chipami **Przejazdy · Noclegi · Moje** (dziś trzy osobne zakładki). Trasy `/przejazdy`, `/noclegi`, `/moje-wyjazdy` zostają jako przekierowania.
- **Szuflada (☰)**, pogrupowana: nagłówek konta (awatar, imię, „Parent Verified”, wejście do **Profilu**) · **Szybkie akcje** (Dodaj wyjazd, Dodaj ofertę przejazdu) · **Mój klub** (tylko trener) · **Pomoc** (jak to działa, zgłoś błąd, regulamin, polityka) · **Wygląd** (auto / jasny / ciemny) · Wyloguj.
- Przycisk „＋” (prawy górny róg) zależy od ekranu: Start/Wyjazdy: dodaj wyjazd lub ofertę; Turnieje: brak; Wiadomości: brak.

## Etapy (każdy: kod → testy automatyczne → zrzuty strony → Pixel 8 jasny/ciemny → commit)

| # | Etap | Zakres | Testy |
|---|------|--------|-------|
| 0 | Przygotowanie | JDK 21 do lokalnego buildu, skrypt budowania i instalacji APK na Pixel 8, zrzuty stanu wyjściowego | emulator uruchamia się, APK się instaluje |
| 1 | Ikona | zasoby Androida (adaptive + monochrome), favicony, apple-touch, manifest PWA, `theme-color`, ikona na stronach docs | ikona w launcherze, favicon w przeglądarce, testy statyczne |
| 2 | Tokeny i motyw | tokeny ze standardu jako zmienne CSS, aliasy starych nazw, jasny/ciemny/wysoki kontrast według telefonu + ręczny wybór, czcionka systemowa (bez Google Fonts), `prefers-reduced-motion` | testy tokenów, kontrast, UI na jasnym i ciemnym |
| 3 | Komponenty bazowe | szkło, przyciski (główny/tonalny/niebezpieczny), pola, karty `.sec`, sekcje rozwijane, chipy, wiersze, toast, stany puste | testy struktury, zrzuty galerii komponentów |
| 4 | Szkielet aplikacji | przycisk menu, pływający pasek 4 zakładek, szuflada (z pamięcią otwarcia sekcji), „＋”, bezpieczne obszary, przycisk „wstecz” (JS + `MainActivity`), nowy hub „Wyjazdy” | testy kolejności zamykania nakładek, nawigacji, aria; Pixel 8 z paskiem 3-przyciskowym |
| 5 | Ekrany | Start, Turnieje, Wyjazdy (3 chipy), Wiadomości, Profil (sekcje), Logowanie/Rejestracja (+captcha), Klub, Ustawienie hasła | testy UI istniejące + nowe; zrzuty każdego ekranu |
| 6 | Strona | nowa strona główna, wspólne tokeny dla `docs/*.html` (regulamin, polityka, dokumentacja, testerzy, admin), widok aplikacji na komputerze (pasek zakładek u góry po lewej) | testy statyczne stron, zrzuty szerokości 360/768/1280 |
| 7 | Dostępność i szlify | kontrast 4,5:1 w obu motywach, cele dotyku 44 px, `aria-*`, `:focus-visible`, `inert` szuflady, wysoki kontrast, poziomy układ, mały telefon 360 px, klawiatura ekranowa | lista kontrolna ze standardu (część 9), zrzuty |
| 8 | Wydanie | wersja, build APK na CI, aktualizacja `tests/README`, dokumentacji i pamięci | pełny zestaw testów, smoke, live |

## Zasady pracy
- Nie zmieniam identyfikatorów, logiki ani zapytań do bazy; tylko wygląd i strukturę nawigacji.
- Każdy etap kończy się osobnym commitem; po każdym pełny zestaw `npm test` musi być zielony.
- Zrzuty z Pixel 8 robię z Basha (`adb exec-out screencap -p`), tryb nocny przełączam `adb shell cmd uimode night yes|no`, pasek 3-przyciskowy `cmd overlay enable-exclusive`.
- Pytania do Pawła zadaję przed etapem, w którym decyzja ma skutek.
