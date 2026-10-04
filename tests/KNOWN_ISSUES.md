# Luki z audytu bezpieczeństwa (stan na 2026-10-03)

Każda luka ma identyfikator `F<n>`. Testy opisujące zachowanie **bezpieczne**, które dziś jeszcze zawodzą,
są oznaczone `itKnown("F<n>", …)` (JS) albo `@unittest.expectedFailure` (Python): pakiet przechodzi, a luka
jest widoczna w raporcie. Gdy naprawisz lukę, zamień `itKnown` na `it` i skreśl wiersz poniżej.

```bash
TT_SHOW_KNOWN=1 npx vitest run   # prawdziwe powody niepowodzenia znanych luk
```

## Naprawione w kodzie (wymagają wdrożenia na produkcję)

| ID | Co naprawiono | Gdzie |
|----|---------------|-------|
| F1 | Użytkownik nie nada sobie `is_admin`, `verified`, nie zdejmie zawieszenia | migracja 0043 |
| F2 | Rola trenera wymaga zatwierdzenia przez administratora (przycisk w panelu admina) | 0043, `AuthPage`, `ProfilePage`, `docs/admin.html` |
| F4 | Anonim nie czyta `bug_reports` i `signup_attempts` (licznik przez funkcję) | 0044, `AuthPage`, `docs/testerzy.html` |
| F5 | `notify-tournament` wymaga sekretu wywołań; `pzt-player-lookup` wymaga zalogowania i sprawdza format loginu | 0045, funkcje brzegowe, workflow, skrypt importu |
| F6 | Rozmówca nie widzi telefonu (karta konta tylko z imieniem i nazwiskiem) | 0047, `useConversations` |
| F7 | Rodzic może wycofać zgodę; wycofanie blokuje nowe prośby o nocleg u rodziny | 0046, `useConsents`, `ProfilePage` |
| F8 | Obcy widzą tylko kartę zawodnika (imię, kategoria, klub), nie nazwisko/rocznik/miasto/login PZT | 0047, osadzenia `players:player_cards(...)` |
| F9 | Prośby i zapytania startują jako `pending`; oferta i wyjazd niezmienne; dozwolone tylko właściwe przejścia statusów | 0046 |
| F10 | Do rozmowy można dopisać tylko w pustej lub własnej; naprawiony także czat dla zapytań o podwiezienie | 0046 |
| F11 | Zgodę dodaje tylko właściciel zawodnika | 0046 |
| F13 | Funkcje triggerów mają `search_path` | 0049 |
| F14 | Funkcje pomocnicze RLS niedostępne dla anonima | 0049 |
| F3 | Usuwanie konta i danych (RODO): kaskady kluczy, `delete_my_account()`, przycisk w profilu | 0048, `AuthContext`, `ProfilePage` |
| F12 | Szkic regulaminu i polityki prywatności (do weryfikacji prawnika, pola `[DO UZUPEŁNIENIA]`) | `docs/regulamin.html`, `docs/polityka-prywatnosci.html` |
| F15 | `allowBackup="false"` | `AndroidManifest.xml` |
| F17 | Akcja `softprops/action-gh-release` przypięta do skrótu commita | workflow |
| F18 | Adres strony turnieju przepuszczany tylko jako http/https | `TournamentsPage` |
| F19 | `esc()` w panelu admina zamienia także cudzysłowy | `docs/admin.html` |
| F20 | Workflow z kluczem `service_role` mają `permissions: contents: read` | workflow |
| F21 | Retencja danych: `purge_old_data()` plus workflow tygodniowy | 0050, `retention.yml` |
| F22 | Zgoda na regulamin zapisywana przy rejestracji (`terms_accepted_at`, `terms_version`) | 0051, `AuthPage`, `AuthContext` |
| F23 | Limity długości pól (NOT VALID, tylko nowe dane) | 0044, 0050 |
| F16 | APK dla testerów podpisane prywatnym kluczem z sekretów GitHub (`ANDROID_KEYSTORE_*`), nie publicznym `debug.keystore` | `android-debug-apk.yml`, `build.gradle` |
| F28 | Zepsuty JSON do `notify-tournament` daje 400 zamiast 500 | funkcja brzegowa |
| F29 | Korzeń strony ma `index.html` (kod 200) | `docs/index.html` |

## Otwarte

| ID | Luka | Test |
|----|------|------|
| F24–F27 | Pozycje z audytu bez osobnego testu: **opisy do uzupełnienia** z raportu audytu. | – |

## Co trzeba zrobić na produkcji (kolejność)

1. SQL Editor: migracje `0043` do `0051` po kolei (każda osobno; po każdej sprawdź, że nie ma błędu).
2. Sekret wywołań funkcji: instrukcja w `supabase/functions/notify-tournament/README.md` (najpierw baza i GitHub, na końcu funkcja).
3. Wdrożenie funkcji brzegowych: `supabase functions deploy notify-tournament` i `pzt-player-lookup`.
4. Wypchnięcie plików workflow (`retention.yml` jest nowy; pozostałe tylko zmienione) wykonujesz sam.
5. Nowa wersja aplikacji (APK i strona), bo zmieniły się zapytania (`player_cards`, `account_cards`), rejestracja i profil.
6. Uzupełnić `[DO UZUPEŁNIENIA]` w regulaminie i polityce prywatności i oddać prawnikowi.
