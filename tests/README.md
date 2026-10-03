# Testy Tennis Together

Pakiet około 670 testów w sześciu warstwach. Nie wymaga dostępu do produkcji (poza warstwą `live`,
która tylko czyta jako anonim) ani Dockera: baza to PGlite (Postgres w WASM) z prawdziwymi migracjami.

| Warstwa | Katalog | Co sprawdza | Uruchomienie |
|---------|---------|-------------|--------------|
| Baza | `tests/db` | RLS, triggery, funkcje SECURITY DEFINER, eskalacja uprawnień, kalkulator kosztów, kody spotkań, push | `npm run test:db` |
| Statyczne | `tests/static` | sekrety, Android, CSP/XSS, workflow CI, funkcje brzegowe, RODO, higiena migracji | `npm run test:static` |
| Jednostkowe | `tests/unit` | eksport do kalendarza, geo, formaty PZT | `npm run test:unit` |
| UI | `tests/ui` | strony React na atrapie Supabase (Rides, Auth, Turnieje, Start, Wyjazdy, komponenty) | `npm run test:ui` |
| Python | `tests/python` | skrypty (cena paliwa, smoke test) z atrapą sieci | `python -m unittest discover -s tests/python` |
| Live | `tests/live` | czarna skrzynka na produkcji jako anonim (tylko odczyty/odrzucone zapisy) | `python -m unittest discover -s tests/live` |
| Mutacje | `tests/mutation` | psuje migracje celowo i sprawdza, czy testy bazy to wykryją | `node tests/mutation/run_mutations.mjs [nr ...]` |

Całość JS: `npm test`. Tryb obserwowania: `npm run test:watch`.

## Jak działa baza testowa

`tests/db/globalSetup.mjs` raz buduje szablon bazy (shim ról `anon/authenticated/service_role`,
`auth.uid()` z `request.jwt.claim.sub`, atrapa storage i `net.http_post`, potem wszystkie migracje
z `supabase/migrations`) i zapisuje go w `tests/.cache/` (klucz = skrót migracji). Każdy plik testowy
ładuje kopię w ok. 0,6 s. `tests/helpers/db.mjs` daje `as(uid)`, `anon()`, `service()` i fabryki danych.

## Znane luki

Luki, których jeszcze nie załatano, mają testy `itKnown(...)` (`it.fails`), więc pakiet jest zielony,
a luka widoczna. Spis i instrukcja „co zrobić, gdy naprawisz": [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## Zmienne środowiskowe

- `TT_SHOW_KNOWN=1` – znane luki uruchamiane jako zwykłe testy (pokazują prawdziwe niepowodzenie).
- `TT_MIGRATIONS_DIR=<katalog>` – testy bazy na innym zestawie migracji (np. z kandydatem `0043`).
- `TT_OFFLINE=1` – pomija testy wymagające sieci (warstwa live).

## Dobre praktyki przy dopisywaniu testów

- Nowa migracja = nowy test w `tests/db` (RLS dla anon / obcego / właściciela / administratora).
- Test blokady zapisu sprawdzaj kodem `42501`; przy `INSERT … RETURNING` pamiętaj, że wymaga on widoczności wiersza.
- Zapis anonima testuj z pustym `{}` (kolumny domyślne), inaczej nieznana kolumna da 400 niezależnie od RLS.
- Po dodaniu zabezpieczenia uruchom `run_mutations.mjs` i dopisz mutację, która je psuje.
