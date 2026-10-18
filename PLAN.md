# Tennis Together — plan i decyzje

Apka ma rozwiązywać jeden problem: koszt i organizację wyjazdów na turnieje
tenisowe (przejazdy, noclegi, grupy wyjazdowe). Pełne założenia funkcjonalne
w `docs/ATZ_Aplikacja_Zawodnicy_Rodzice_Zalozenia.docx`.

## Decyzje (ustalone 2026-09, Paweł)

- **Podmiot prowadzący:** jeszcze nie wybrany — do ustalenia przed publikacją
  (wpływa na konto deweloperskie, administratora danych, regulamin).
- **Platformy:** Android (Capacitor) + PWA równolegle od startu. iOS dochodzi
  później, przed publikacją produkcyjną.
- **Nocleg u rodziny innego zawodnika:** **odłożony na etap 2** — najpierw
  sprawdzamy popyt na resztę aplikacji, potem wracamy do tego z weryfikacją
  tożsamości i konsultacją prawną.
- **Konta:** tylko dorośli (rodzic/opiekun/trener) zakładają konto. Zawodnik
  jest profilem pod kontem rodzica. Zawodnik 16+ może mieć własne logowanie,
  powiązane z rodzicem.
- **Nazwa robocza:** Tennis Together (domena jeszcze nie kupiona).
- **Zespół:** głównie Paweł + Claude Code, programista pomocniczy dopiero na
  późniejszym etapie.
- **Zasięg startu:** cała Polska od pierwszego dnia (nie wąski region) — patrz
  ryzyko "zimny start" niżej, kompensujemy to panelem trenera/klubu w MVP.
- **Budżet:** ograniczony na start — wszystko na darmowych/najtańszych planach,
  płatne dopiero jak będzie ruch. **Supabase Free** (sprawdzone 2026-09,
  supabase.com/pricing): 500 MB bazy, 1 GB storage, 50 000 MAU, 5 GB
  transferu/mies., 2 darmowe projekty, bez karty kredytowej, użycie
  komercyjne dozwolone. Wystarczy z dużym zapasem na fazę budowy i pierwsze
  testy. Jedyny haczyk: darmowy projekt usypia się po 7 dniach bez ruchu i
  budzi się sam przy pierwszym zapytaniu (parę sekund opóźnienia) — jeśli
  zrobimy dłuższą przerwę, może trzeba będzie ręcznie "obudzić" go w panelu.
  Przejście na Pro (od 25 USD/mies., głównie: brak usypiania + kopie
  zapasowe) dopiero gdy zbliżymy się do limitów albo aplikacja ma już
  żywych użytkowników.
- **Termin:** działające MVP do końca 2026 (orientacyjnie ~3,5 miesiąca od
  2026-09-10 — to jest napięty harmonogram, patrz "Ryzyka terminu" niżej).
- **Design:** nowy, własny styl marki (nie kopiujemy wyglądu apki PZT) —
  identyfikacja wizualna do zaprojektowania równolegle z budową MVP.
- **Regulamin / polityka prywatności:** czekamy na prawnika, nie tworzymy
  roboczych wersji na własną rękę.
- **GitHub:** repo pod kontem `pmesznik` — https://github.com/pmesznik/Tennis-Together
- **Dane o turniejach:** reużywamy scraper OTK z projektu PZT
  (`portal.pzt.pl`, patrz `NOWA APLIKACJA PZT ANDROID/analyzer.py` i
  `pzt_player_scraper.py`). Tennis Europe i ITF na start — ręcznie/zgłoszenia.
- **Panel trenera/klubu:** wchodzi do MVP (nie etap 2) — jeden trener = od
  razu 5–10 rodzin, kluczowe przy starcie ogólnopolskim bez wąskiego regionu
  testowego.
- **Monetyzacja:** brak w MVP, całkowicie bezpłatne na start.

## Identyfikacja wizualna (UX/branding)

Koncepcja graficzna przygotowana przez Pawła:
`docs/UX_Branding_Tennis_Together.docx` ("Neon Court & Cyber Clay").
Wdrożona jako design tokens w `src/styles/tokens.css` + demo na stronie Start.

- **Styl:** glassmorphism, Dark Mode Premium domyślnie (oszczędza baterię na
  całodniowych turniejach), Light Mode jako ręczny przełącznik (czytelność w
  słońcu na korcie) — nie podłączony pod ustawienia systemowe telefonu.
- **Uwaga (2026-10-18):** poniższa paleta i typografia są historyczne. Aplikacja ma nowy wygląd (mięta `#8EE3C8` i grafit `#1F2933`, czcionka systemowa), patrz [PLAN_NOWY_WYGLAD.md](PLAN_NOWY_WYGLAD.md).
- **Paleta (historyczna):** Tennis Ball Neon `#D4FF00` (primary), Clay Court Coral `#FF5E3A`
  (secondary), Emerald/Cyan (`#10B981` / `#00F0FF`) na odznakę "Parent
  Verified", Deep Court Graphite `#0D131E` (tło dark), Soft Ice Gray `#F4F6FB`
  (tło light).
- **Odstępstwo od dokumentu:** w light mode odcienie neonu i koralu są
  przyciemnione (`#7A9400`, `#C2431F`) względem oryginalnych kodów — surowe
  `#D4FF00`/`#FF5E3A` nie dają wystarczającego kontrastu tekstu na jasnym tle
  (WCAG AA). Na dark mode oryginalne kolory zostają.
- **Typografia:** nagłówki Plus Jakarta Sans, treść Inter — oba darmowe
  (Google Fonts). Dokument proponował też płatny Clash Display do nagłówków;
  pominięty na start ze względu na ograniczony budżet, do rozważenia później.
- **"Parent Verified":** w MVP to weryfikacja telefonu/e-maila (kolumna
  `accounts.verified` w schemacie), nie weryfikacja dokumentu tożsamości —
  ta cięższa wersja ma sens przy "noclegu u rodziny" w etapie 2.
- Nazwa w dokumencie brzmi "Tennis Trip" (robocza nazwa z wcześniejszego
  etapu) — w kodzie i repo zostaje ustalone "Tennis Together".
- **Ikona aplikacji** (2026-09-11, dostarczona przez Pawła):
  `docs/app-icon-source.png` (1254×1254, niebieska zaokrąglona plakietka —
  piłka tenisowa + ludzie + samolot/auto). Wygenerowane z niej automatycznie:
  `public/icon-192.png` / `icon-512.png` (PWA, przezroczyste narożniki) oraz
  komplet ikon Androida (`android/app/src/main/res/mipmap-*`) — legacy
  `ic_launcher`/`ic_launcher_round` per gęstość + adaptive icon
  (`ic_launcher_foreground` zmniejszony do 68% wewnątrz "safe zone", żeby
  żadna maska launchera — koło, squircle — nie ucinała samolotu/auta na
  krawędziach; tło adaptacyjne ustawione na dominujący niebieski z ikony,
  `#074BA8`). Nie dotyka to kolorystyki UI w apce (`tokens.css`) — ikona ma
  świadomie inną, własną kolorystykę niż "Neon Court" w środku.

## Architektura

| Warstwa | Wybór |
|---|---|
| Aplikacja | React + Vite + Capacitor (ten sam zestaw co w projekcie PZT) |
| Backend | Supabase (Postgres + PostGIS + Auth + Realtime), region UE/Frankfurt |
| Powiadomienia | Firebase Cloud Messaging + `@capacitor/push-notifications` |
| Import turniejów | GitHub Actions (cron) + scraper z projektu PZT |
| Błędy | Sentry (do podłączenia przed betą) |

Brak własnego backendu FastAPI — logowanie, RLS, czat i kopie zapasowe
zapewnia Supabase od razu, bez pisania tego samodzielnie.

## Model danych (MVP)

Schemat startowy: `supabase/migrations/0001_init.sql`.

- **Ludzie:** `accounts` (dorośli), `players` (profile pod rodzicem),
  `consents` (zgody z datą).
- **Turnieje i wyjazdy:** `tournaments`, `trips` ("Jadę" — zawodnik + turniej +
  miejsce wyjazdu + daty).
- **Przejazdy/noclegi:** `ride_offers`/`ride_requests`,
  `ride_join_requests` (prośba → akceptacja → dane kontaktowe się odblokowują),
  analogicznie `lodging_*`.
- **Grupy i czat:** `trip_groups`, `conversations`, `messages`.
- **Bezpieczeństwo:** `reports`, `blocks` (od pierwszego dnia, nie opcjonalne).

**Dopasowania w MVP:** ten sam turniej + nakładające się daty (±1 dzień) +
miejsce wyjazdu w promieniu X km (PostGIS, jedno zapytanie). Dopasowanie "po
trasie" — etap 2.

**Prywatność:** lista "kto jedzie" pokazuje imię, kategorię, region. Nazwisko,
telefon i dokładne miejsce zbiórki — tylko po zaakceptowaniu prośby
(`ride_join_requests` / `lodging_join_requests`).

## MVP — zakres

W MVP:
- rejestracja dorosłych, profile zawodników, zgody
- kalendarz: OTK automatycznie, TE/ITF ręcznie
- "Jadę" → karta wyjazdu
- dopasowania (turniej + termin + trasa)
- przejazdy: "mam miejsce" / "szukam" + prośba/akceptacja
- noclegi: wspólny obiekt / współlokator (bez "u rodziny")
- grupa wyjazdowa + czat
- powiadomienia push
- zgłoś/zablokuj użytkownika, usuwanie konta
- **panel trenera/klubu** (wyjazd klubowy, lista zawodników)
- prosty panel administratora do moderacji

Etap 2: nocleg u rodziny, oceny, liczenie/podział kosztów, mapa przejazdów,
integracja kalendarzy. Etap 3: rezerwacje w aplikacji, system reputacji,
model biznesowy (z dokumentu założeń, sekcje 19–21).

## Ryzyka

1. **Zimny start + start ogólnopolski.** Dopasowania działają tylko przy
   krytycznej masie użytkowników na tym samym turnieju. Mitygacja: panel
   trenera/klubu w MVP, karta wyjazdu użyteczna nawet solo (plan/koszty/lista
   rzeczy), ambasadorzy-trenerzy, QR/link w komunikatach organizatorów.
2. **Termin koniec 2026 jest napięty** na pełny zakres MVP powyżej przy jednej
   osobie piszącej kod. Jeśli się nie wyrobimy — pierwsza rzecz do wycięcia:
   panel admina rozbudowany (zostaje minimalny), potem integracja TE/ITF
   (zostaje ręczne dodawanie).
3. **Dzieci + dane + nocleg.** Rozwiązane architekturą kont (tylko dorośli)
   i odłożeniem "nocleg u rodziny" na etap 2 — ale regulamin/polityka
   prywatności i DPIA muszą powstać z prawnikiem przed betą z udziałem
   zewnętrznych klubów (nie tylko ATZ).
4. **Przejazdy za pieniądze = przewóz osób.** Regulamin musi jasno mówić, że
   to dzielenie kosztów, nie usługa przewozu, i że aplikacja nie jest
   przewoźnikiem. Bez prawnika na razie nie formułujemy tego tekstu.

## Lista kontrolna „gotowe do produkcji”

- RLS uzupełnione na każdej tabeli (dziś gotowe tylko dla `players` jako
  przykład) + test, że rodzina A nie widzi danych rodziny B
- kopie zapasowe z przywracaniem do punktu w czasie, osobna baza prod/staging
- Sentry + ograniczenie liczby zapytań
- podpisany plik AAB z numerem wersji w nazwie (jak w projekcie PZT)
- formularz "Bezpieczeństwo danych" + ankieta treści w Google Play, link do
  polityki prywatności
- kolejka zgłoszeń z czasem reakcji, filtr słów w czacie
- akceptacja regulaminu i zgody rodzica zapisane z datą (`consents`)

## Stan Supabase (2026-09-11)

- Projekt `tennis-together` utworzony, region Frankfurt, plan Free.
- `supabase/migrations/0001_init.sql` uruchomiony — wszystkie 12 tabel
  istnieje i odpowiada przez REST API (zweryfikowane).
- `.env` lokalnie uzupełniony (`VITE_SUPABASE_URL` + nowy format klucza
  `sb_publishable_...`, obsługiwany przez `@supabase/supabase-js@^2.49`).
- Logowanie/rejestracja działają end-to-end: `src/lib/AuthContext.jsx` +
  `src/pages/AuthPage.jsx`. Cała appka jest teraz zabramkowana — bez sesji
  widać ekran logowania zamiast zakładek.
- Rejestracja tworzy wiersz w `accounts` **dopiero po pierwszym
  zalogowaniu**, bo projekt ma domyślnie włączone "Confirm email" (Auth →
  Providers → Email) — dane z formularza (rola, imię) czekają w tym czasie
  w `localStorage`. Do szybszego testowania na dev można wyłączyć "Confirm
  email" w tych ustawieniach; **trzeba je z powrotem włączyć przed betą**
  (bez tego ktoś mógłby zakładać konta na cudzy e-mail).
- Profil rodzica (`ProfilePage.jsx`) pokazuje już prawdziwe imię/rolę/e-mail
  z bazy i ma działające „Wyloguj”. Zgody i historia wyjazdów są nadal
  danymi przykładowymi — `consents`/`trips` jeszcze nie podłączone.
- **Profil zawodnika działa na prawdziwych danych** (`src/lib/usePlayers.js`
  + `ProfilePage.jsx`): dodawanie zawodnika (imię, nazwisko, rok urodzenia,
  kategoria, klub, miasto — opcjonalne pola), przełącznik między kilkoma
  dziećmi tego samego rodzica, formularz od razu widoczny, gdy lista jest
  pusta. Zapisane w `players`, chronione RLS. **Zweryfikowane na żywo przez
  Pawła 2026-09-11** — rejestracja, potwierdzenie e-maila, logowanie i
  dodanie zawodnika przeszły bez problemu.
- **RLS uzupełnione o `accounts`** (`supabase/migrations/0002_accounts_rls.sql`,
  uruchomiona przez Pawła w SQL Editorze) — była to jedyna otwarta tabela z
  prawdziwym zagrożeniem prywatności (każdy z publicznym kluczem anon mógł
  czytać/nadpisywać cudze konta, w tym telefony).
  Pozostałe tabele (`trips`, `ride_offers`, `conversations`, `messages`...)
  są nadal otwarte, ale świadomie odłożone — żadna z nich nie jest jeszcze
  podłączona pod prawdziwe zapytania (dalej korzystają z `mockData.js`),
  więc pisanie im polityk RLS teraz byłoby zgadywaniem bez możliwości
  przetestowania. Robimy to tabela po tabeli, w miarę jak każda dostaje
  prawdziwy ekran.
- Podczas testów rejestracji powstało testowe konto na wymyślony adres
  `pawel.test.tennistogether@gmail.com` (niepotwierdzone, nikt się nim nie
  zaloguje) — do usunięcia w Authentication → Users w panelu Supabase,
  jeśli przeszkadza.

## Import turniejów OTK (2026-09-11)

- `scripts/import_tournaments.py` — port scrapera `scrape_tournaments_list()`
  z projektu PZT (bez logowania do PZT, bez pola "registration"). **Przetestowany
  na żywo** przeciwko portal.pzt.pl (lokalnie, dry-run): 53 turnieje w 4
  kategoriach (U12/U14/U16/U18), poprawne polskie znaki, kilka wpisów bez
  miasta (np. mistrzostwa drużynowe) — stąd decyzja, żeby `city` było
  nullable. Ten widok PZT nigdy nie podaje daty zakończenia turnieju, więc
  `ends_on` też jest nullable (wolimy pokazać "nieznana" niż zgadywać złą datę).
- `supabase/migrations/0003_tournaments.sql` — powyższe zmiany kolumn + RLS
  na `tournaments` (publiczny odczyt dla zalogowanych, zapis tylko przez
  `service_role`). **Jeszcze nie uruchomiona w bazie.**
- `.github/workflows/import-tournaments.yml` — cron codziennie o 2:00 UTC +
  ręczne uruchomienie. **Wymaga sekretu `SUPABASE_SERVICE_ROLE_KEY`** w
  Settings → Secrets and variables → Actions (klucz "secret"/service_role z
  Project Settings → API Keys w Supabase — inny niż `VITE_SUPABASE_ANON_KEY`
  używany w appce; ten omija RLS, więc tylko jako sekret CI, nigdy w `.env`).
- Zakładka Turnieje (`TournamentsPage.jsx` + `src/lib/useTournaments.js`)
  czyta już prawdziwe dane z `tournaments` zamiast `mockData.js`. Build
  przechodzi, ekran logowania (niezależny od tej zmiany) zweryfikowany bez
  błędów konsoli — **pełny widok z danymi jeszcze nie zweryfikowany na żywo**
  (czeka na migrację 0003 + pierwszy import + Twoją prawdziwą sesję).
  Przycisk „Jadę na ten turniej” nadal nic nie zapisuje (patrz niżej).

## Android — lekcje przeniesione z projektu PZT (2026-09-11)

Trzy problemy, na które PZT Rankingi wpadło dopiero po fakcie (i wymagały
naprawy w locie) — tu zaadresowane od razu, zanim zdążyły się ujawnić:

- **Paski systemowe zasłaniały appkę** (`viewport-fit=cover` bez
  `env(safe-area-inset-*)` na nagłówku/dolnym menu/ekranie logowania) —
  naprawione w `App.jsx` i `AuthPage.jsx`. Zgłoszone przez Pawła po
  zainstalowaniu pierwszego debug APK.
- **Service Worker rejestrujący się też wewnątrz natywnej apki** — w PZT
  powodowało to "utkniętą" starą wersję po aktualizacji (stary SW w WebView
  przechwytywał żądania). Tu zapobieżone prewencyjnie: `injectRegister: null`
  w `vite.config.js` + rejestracja w `main.jsx` tylko gdy
  `!Capacitor.isNativePlatform()`.
- **`versionCode` zaszyty na sztywno** — w PZT był "1" od pierwszego builda,
  co też blokowało aktualizacje. Tu: `build.gradle` czyta go z
  `-PappVersionCode` (numer przebiegu CI), ale trzeba pamiętać, żeby ta
  flaga była w **każdym** workflow budującym APK — przy pierwszym labie tej
  naprawy zapomniałem jej dodać do `android-debug-apk.yml` (dodał tylko do
  `android-build.yml`), poprawione tego samego dnia.

Pełny opis wzorca (do zastosowania w KOLEJNYCH projektach Capacitor od
pierwszego dnia, nie po fakcie) zapisany w pamięci: `android-safe-area-insets`
i `capacitor-sw-versioncode`.

**Czwarty problem, znaleziony tego samego dnia:** `android-debug-apk.yml` na
świeżej maszynie GitHub Actions generował za każdym razem INNY, losowy klucz
debug (`~/.android/debug.keystore` nie jest zapamiętywany między
uruchomieniami CI) — Android traktował appkę podpisaną innym kluczem jako
inną aplikację i blokował instalację "aktualizacji" (trzeba było
odinstalować poprzednią wersję). Naprawione: `android/app/debug.keystore`
ze standardowymi, publicznie znanymi danymi (nie sekret) wygenerowany RAZ
przez CI i zacommitowany do repo — od buildu #7 każdy kolejny ma ten sam
podpis. Po drodze złapany i naprawiony błąd składni YAML (wieloliniowy
komunikat commita bez wcięcia w bloku `run: |` łamał parsowanie całego
pliku workflow — od tego czasu każdy plik `.yml` jest walidowany lokalnie
przez PyYAML przed pushem).

**Dystrybucja debug APK:** oprócz artifactu w zakładce Actions (wymaga
zalogowania do GitHub), `android-debug-apk.yml` publikuje teraz też
**GitHub Release** (`softprops/action-gh-release@v2`, tag `debug-vN`,
`prerelease: true`) — stały publiczny link do pobrania wprost w
przeglądarce na telefonie, bez logowania. Nie rozważamy dystrybucji przez
Google Play (świadoma decyzja Pawła) — jeśli sideloading APK zacznie
sprawiać kłopoty z Play Protect na szerszą skalę, jedyna droga bez Play
Store to instalacja przez ADB (kabel USB), do rozważenia później.
**Zasada robocza: przy każdym nowym buildzie APK, link do Release podawany
w czacie** (Paweł prosił o to wprost, 2026-09-11).

## Turnieje → wyjazdy (2026-09-11)

- **"Jadę na ten turniej" zapisuje teraz naprawdę** (`TournamentsPage.jsx`):
  klik otwiera formularz (wybór zawodnika, jeśli rodzic ma więcej niż
  jednego + **miasto wyjazdu**, wymagane — to jest to, po czym docelowo
  działa system dopasowań z dokumentu założeń, więc nie mogło zostać
  pominięte nawet w najprostszej wersji). Tworzy wiersz w `trips`.
- **"Moje wyjazdy" czyta prawdziwe dane** (`TripsPage.jsx` +
  `src/lib/useTrips.js`) zamiast `mockData.js`. Zakładki
  nadchodzące/w trakcie organizacji/zakończone są wyliczane z daty turnieju
  i pola `trips.status` (nowy wyjazd = "planning" = trafia do "w trakcie
  organizacji", dopóki nic go nie potwierdzi).
- **RLS na `trips`** (`0004_trips_rls.sql`) i na `tournaments`
  (`0003_tournaments.sql`) — **uruchomione przez Pawła, potwierdzone.**
- **Import turniejów OTK — działa.** Pierwsza próba (workflow „Import
  turniejów OTK") wysypała się z `InvalidHeader`: sekret
  `SUPABASE_SERVICE_ROLE_KEY` w GitHub zawierał jakiś biały znak (pewnie
  kopiowanie "na oko"). Naprawione w `scripts/import_tournaments.py` —
  skrypt teraz usuwa WSZYSTKIE białe znaki z klucza, nie tylko brzegi.
  Drugie uruchomienie: sukces, wszystkie kroki przeszły (scraper znalazł
  20 turniejów przy pierwszej, nieudanej próbie zapisu — sam scraping
  działał od początku).

## Przejazdy (2026-09-11)

- **Zakładka Przejazdy czyta i zapisuje prawdziwe dane**
  (`RidesPage.jsx` + `src/lib/useRides.js`) zamiast `mockData.js`. Oba
  kierunki ("Mam wolne miejsce" / "Szukam przejazdu") — lista widoczna dla
  wszystkich zalogowanych + formularz dodawania, który wymaga wybrania
  jednego z WŁASNYCH wyjazdów (z "Moje wyjazdy") jako punktu odniesienia.
  Jeśli użytkownik nie ma jeszcze żadnego wyjazdu, widzi podpowiedź z
  linkiem do zakładki Turnieje zamiast pustego formularza.
- **"Poproś o miejsce" / "Zaproponuj przejazd" / "Napisz" są nadal
  nieaktywne** (oznaczone "wkrótce") — wymagają ekranu zarządzania
  `ride_join_requests` (akceptacja przez właściciela oferty) i czatu,
  których jeszcze nie ma.
- **RLS** (`supabase/migrations/0005_rides_rls.sql`): `ride_offers` i
  `ride_requests` czytelne dla każdego zalogowanego (to jest sens tej
  funkcji), zapis tylko przez właściciela powiązanego wyjazdu. Dodatkowo
  kaskadowa widoczność `trips`/`players` — wyjazd i zawodnik stają się
  publicznie widoczni (imię, miasto wyjazdu — nie telefon, ten jest gdzie
  indziej) dopiero gdy ich właściciel doda do nich ofertę/prośbę o
  przejazd. Realizuje zasadę "imię i region widoczne od razu, reszta po
  akceptacji" z dokumentu założeń. `ride_join_requests` ma włączone RLS
  bez żadnej polityki (czyli zablokowane dla wszystkich poza
  service_role) — czeka na ekran zarządzania. **Uruchomiona przez Pawła,
  potwierdzone.**

## Noclegi (2026-09-11)

- **Zakładka Noclegi czyta i zapisuje prawdziwe dane**
  (`LodgingPage.jsx` + `src/lib/useLodging.js`) zamiast `mockData.js`.
  Jedna tabela `lodging_offers` z polem `kind`
  (`shared_booking`/`roommate_wanted`) zamiast dwóch osobnych jak przy
  przejazdach — schemat bazy tak to od początku modelował. Formularz
  dodawania wymaga wybrania jednego z własnych wyjazdów, tak jak
  w Przejazdach.
- **"Nocleg u zawodnika" zostaje wyszarzoną kartą "Etap 2"** — bez zmian,
  nie ma odpowiednika w schemacie (`kind` dopuszcza tylko te dwie
  wartości), zgodnie z wcześniejszą decyzją o odłożeniu.
- **"Dołącz" nadal nieaktywne** (oznaczone "wkrótce") — czeka na ten sam
  ekran zarządzania prośbami co "Poproś o miejsce" w Przejazdach
  (`lodging_join_requests` ma dokładnie taki sam wzorzec RLS jak
  `ride_join_requests`: włączone, bez polityk, czeka).
- **RLS** (`supabase/migrations/0006_lodging_rls.sql`) — ten sam wzorzec
  co 0005, plus **rozszerzenie** (nie zastąpienie) kaskady widoczności
  `trips`/`players` o wyjazdy z ofertą TYLKO noclegową (bez oferty
  przejazdu) — polityki RLS są OR'owane, więc 0005 i 0006 współpracują.
  Podana Pawłowi do uruchomienia — **status niepotwierdzony** (padło
  "pracuj dalej" zanim potwierdził wprost).
- Build zweryfikowany, ekran logowania bez błędów konsoli — **pełny
  przepływ Noclegów jeszcze nie zweryfikowany na żywo**.

## Akceptacja próśb o dołączenie (2026-09-11)

- **"Poproś o miejsce" (Przejazdy) i "Dołącz" (Noclegi) działają
  naprawdę.** `src/lib/useJoinRequests.js` — jeden hook parametryzowany
  `kind: "ride" | "lodging"` (te dwie tabele mają identyczny kształt),
  zwraca `incoming` (prośby na MOJE oferty) i `outgoing` (MOJE prośby),
  rozdzielone po `created_by_account_id` w embedowanych wyjazdach. RLS
  (patrz niżej) i tak każdemu pokazuje tylko wiersze, w których jest
  stroną — podział w JS jest tylko dla wygody wyświetlania.
- **Nowa sekcja "Prośby o dołączenie do Twoich..."** na górze
  RidesPage/LodgingPage (widoczna tylko, gdy są jakieś przychodzące
  prośby) — Akceptuj/Odrzuć.
- **Karta oferty** rozpoznaje trzy stany: to Twoja własna oferta ("To
  Twoja oferta"), już wysłałeś prośbę (status: oczekuje/zaakceptowano/
  odrzucono) albo możesz jeszcze poprosić (przycisk → wybór własnego
  wyjazdu → potwierdzenie).
- **RLS** (`supabase/migrations/0007_join_requests_rls.sql`): proszący
  tworzy/usuwa tylko swoje prośby (dla własnego wyjazdu), obie strony
  widzą prośbę, tylko właściciel oferty może zaakceptować/odrzucić
  (`update`). To domyka model prywatności z dokumentu założeń —
  wcześniej te dwie tabele były całkowicie zablokowane (RLS włączone,
  zero polityk). **Jeszcze nie uruchomiona w bazie.**
- Build zweryfikowany, ekran logowania bez błędów konsoli — **pełny
  przepływ (prośba → akceptacja) jeszcze nie zweryfikowany na żywo**,
  wymaga dwóch różnych kont testowych (proszący + właściciel oferty) do
  pełnego sprawdzenia.

## Wiadomości (2026-09-11)

- **Ostatni ekran zszedł z danych-atrap.** `MessagesPage.jsx` +
  `src/lib/useConversations.js` + `src/lib/useMessages.js` — lista
  rozmów i czat na prawdziwych danych. `src/mockData.js` wyczyszczony do
  jednego pozostałego wpisu (`MOCK_PARENT_PROFILE.consents` +
  `.completedTrips` — jedyne, co w całej apce nadal jest atrapą).
- **Rozmowa powstaje automatycznie przy akceptacji prośby** (w
  `useJoinRequests.js`, przy `respond(id, "accepted")`) — to jedyna droga
  do napisania do kogoś w MVP, zgodnie z zasadą z dokumentu założeń
  (kontakt dopiero po akceptacji). Nie ma jeszcze ogólnego "napisz do
  kogokolwiek" ani czatu grupowego (`trip_group_id` w schemacie) — to
  celowo odłożone, `conversations.kind` obsługuje na razie tylko `ride`/
  `lodging`.
- **Bez Supabase Realtime** — zamiast tego proste odpytywanie co 4s,
  dopóki okno czatu jest otwarte (`useMessages.js`). Prostszy, pewniejszy
  mechanizm na start niż konfigurowanie replikacji bez możliwości
  przetestowania na żywo. Do rozważenia później, jeśli odpytywanie okaże
  się za wolne/kosztowne.
- **RLS** (`supabase/migrations/0008_messages_rls.sql`) — najbardziej
  złożona migracja jak dotąd:
  - `is_conversation_participant()` — funkcja `SECURITY DEFINER`,
    bo polityka na `conversation_participants` odwołująca się sama do
    siebie w podzapytaniu powoduje w Postgresie błąd "infinite recursion
    detected in policy" (udokumentowany, częsty pattern przy tabelach
    uczestników rozmów).
  - Dołączenie do `conversation_participants` dozwolone tylko dla dwóch
    stron ZAAKCEPTOWANEJ prośby (przejazd albo nocleg) — nie da się
    dodać nikogo innego.
  - Rozszerzenie widoczności `accounts` (dodatkowa, OR'owana polityka
    obok tej z 0002) — imię widoczne, gdy dzielimy rozmowę. Telefon
    nadal nigdzie nieujawniany w UI.
  Uruchomiona przez Pawła.

## Test na dwóch kontach — cztery błędy znalezione i naprawione (2026-09-11)

Paweł założył drugie konto (`pawelzab@o2.pl` / Konto B) i przetestował z
Claude cały łańcuch na żywo — Konto A na telefonie (debug APK), Konto B
sterowane przez Claude w przeglądarce (localhost:3100), równolegle. Tego
nie dało się złapać inaczej niż realnym testem dwustronnym. Znalezione i
naprawione, po kolei:

1. **`infinite recursion detected in policy` na `ride_offers`/`trips`.**
   Polityka na `trips` (0005/0006) sprawdzała wprost `ride_offers`, a
   polityka na `ride_offers` sprawdzała wprost `trips` — pętla. Blokowało
   to praktycznie całą appkę (nawet dodawanie zawodnika). Naprawa:
   `supabase/migrations/0009_fix_trips_recursion.sql` —
   `trip_has_public_offer()` jako `SECURITY DEFINER`.
2. **Wyjazd proszącego niewidoczny dla właściciela oferty.** Wyjazd stawał
   się publiczny tylko, gdy sam miał ofertę — wyjazd osoby, która tylko
   *prosi* o dołączenie, nigdy nie ma własnej oferty, więc pozostawał
   niewidoczny. Objaw: "Zawodnik · ?" zamiast imienia/miasta proszącego.
   Naprawa: `supabase/migrations/0010_fix_requester_trip_visibility.sql` —
   `trip_is_requester_for_my_offer()`, ten sam wzorzec `SECURITY DEFINER`.
3. **Prawdziwa przyczyna braku rozmów po akceptacji** (ta, która się
   liczyła najbardziej — 1. i 2. tylko do niej prowadziły):
   `insert(...).select("id").single()` na `conversations` robi
   `INSERT ... RETURNING`, co podlega polityce SELECT tej tabeli
   (`is_conversation_participant`) — a w momencie insertu NIKT jeszcze
   nie jest uczestnikiem (dodajemy ich dopiero linijkę niżej). RETURNING
   nie znajduje wiersza → Postgres zgłasza `new row violates row-level
   security policy for table "conversations"` → cały insert się cofa.
   Złapane dopiero z pełnym logiem konsoli (Konto B w przeglądarce, klik
   "Akceptuj" na żywo). Naprawa w `useJoinRequests.js`: generujemy `id`
   rozmowy po stronie klienta (`crypto.randomUUID()`) i wstawiamy bez
   `.select()` — nie trzeba nic czytać z powrotem. Zweryfikowane
   bezpośrednim zapytaniem do REST API (201 Created) PRZED poproszeniem
   Pawła o kolejny test na telefonie.
4. Sekret `SUPABASE_SERVICE_ROLE_KEY` do importu turniejów miał biały
   znak z kopiowania — opisane wyżej przy imporcie turniejów.

**Po tych czterech poprawkach (v19) cały przepływ zweryfikowany na żywo,
w obie strony:** turniej → "Jadę" → oferta przejazdu → "Poproś o
miejsce" → "Akceptuj" → rozmowa pojawia się automatycznie w Wiadomościach
→ wiadomość wysłana z jednego konta dotarła i wyświetliła się na drugim
(odpytywanie co 4s, bez Realtime).

Lekcja zapisana w pamięci na przyszłość: `feedback-supabase-rls-recursion`
— przy modelowaniu "A widzi B, gdy są połączeni relacją" projektować
widoczność z punktu widzenia OBU stron od razu, i nigdy nie kończyć
insertu `.select()`-em na tabeli, której polityka SELECT zależy od
danych, które dopiero za chwilę powstaną.

## Edycja profilu (2026-09-11)

- **„Edytuj profil" i „Edytuj profil zawodnika" działają naprawdę.**
  `AuthContext.jsx` ma teraz `updateAccount()` (imię, telefon, miasto,
  klub), `usePlayers.js` ma `updatePlayer()`. `ProfilePage.jsx`
  przebudowany — formularz dodawania i edycji zawodnika to teraz jeden
  wspólny komponent (`PlayerForm`, różni się tylko wartościami
  startowymi), żeby nie dublować pól.
- Zweryfikowane na żywo na Koncie B: zmiana telefonu/miasta rodzica i
  miasta zawodnika zapisały się i od razu wyświetliły poprawnie, bez
  nowych błędów w konsoli.
- **Dane testowe wyczyszczone** — `delete from trips;` (kaskada usunęła
  oferty/prośby/rozmowy/wiadomości), konta i zawodnicy (Ala/Jag) zostały.

## Turnieje Tennis Europe (2026-09-11)

Zgłoszone przez Pawła: po turniejach polskich trzeba dodać europejskie +
mądrą wyszukiwarkę (kraj, kategoria, i docelowo "kto z mojej okolicy tam
jedzie"). Zbadane i zaimplementowane tego samego dnia:

- **`scripts/import_tennis_europe.py`** — scraper `te.tournamentsoftware.com`
  (platforma "Tournament Software", osobna od `tenniseurope.org`, ale
  podlinkowana z niego jako "Calendar & Results"). W przeciwieństwie do OTK:
  - jedno zapytanie POST zwraca turnieje z **całej Europy naraz**
    (`CountryCode` puste = wszystkie kraje) — nie trzeba pętli po krajach;
  - dostajemy **prawdziwą datę zakończenia**, nie tylko startu (OTK tego
    nie dawał);
  - HTML odpowiedzi jest czysty i ustrukturyzowany (klasy CSS,
    `<time datetime="...">`) — dużo łatwiejszy do parsowania niż OTK.
  - **Paginacja jest kumulatywna** (Page=N zwraca wszystko od 1 do N naraz,
    zweryfikowane ręcznie: Page=10/15/20 dały identyczne 126 wyników) —
    skrypt eskaluje 1→3→9→27 zamiast pętli liniowej, zatrzymuje się, gdy
    liczba wyników przestaje rosnąć. Cały kalendarz (126 turniejów, 35
    krajów, ~9 miesięcy naprzód) w 4 zapytaniach.
  - Kraj tłumaczony z angielskiego na polski (`COUNTRY_PL`, ~50 wpisów) —
    spójność z OTK, gdzie kraj to zawsze "Polska".
  - **Przetestowane lokalnie na żywo** (dry-run, bez zapisu): 126/126
    turniejów z kompletnymi danymi (miasto, kraj, kategoria, obie daty).
    Nieudokumentowane, prywatne API strony trzeciej — jeśli kiedyś zacznie
    zwracać 0 wyników, sprawdzić najpierw czy struktura się nie zmieniła.
  - Migracja bazy **niepotrzebna** — `source='tennis_europe'` był już
    dopuszczony przez CHECK constraint od 0001_init.sql.
- **`.github/workflows/import-tennis-europe.yml`** — cron 2:30 UTC (pół
  godziny po OTK) + ręcznie, ten sam sekret `SUPABASE_SERVICE_ROLE_KEY`.
  **Jeszcze nie uruchomiony na żywo w Supabase** — czeka na ręczne
  „Run workflow" (albo najbliższy cron).
- **Filtry w `TournamentsPage.jsx`** — kategoria i kraj jako `<select>`,
  listy wyliczane dynamicznie z tego, co faktycznie jest w kalendarzu (nie
  na sztywno), więc automatycznie obejmą wszystkie 35 krajów po imporcie.
  Zweryfikowane na żywo (na razie tylko "Polska" widoczna, bo import TE
  jeszcze nie uruchomiony).
- **Jeszcze NIE zrobione — świadomie odłożone jako osobny kawałek pracy:**
  „Znajdź turniej po uczestniku z mojej okolicy" — pomysł Pawła, żeby
  zamiast (albo obok) filtrowania po kraju/kategorii dało się znaleźć
  turnieje, na które ktoś już jedzie z pobliskiej miejscowości. Szkic
  projektu: dopasowanie po `trips.departure_city` (tekstowe, bez
  geokodowania na start — kolumny `departure_lat`/`departure_lng` już
  istnieją w schemacie, ale puste; prawdziwe dopasowanie "w promieniu X km"
  wymagałoby geokodowania miast, np. darmowym Nominatim — osobna decyzja
  na później). Nie zaczęte — do zrobienia w kolejnej turze.
- **📍 Dystans (przycisk w Turnieje)** — usunięty w tej rundzie zmian razem
  z resztą filtrów placeholder; do przywrócenia dopiero z prawdziwym
  geokodowaniem, żeby nie było martwego przycisku.

## Etykieta „PZT" zamiast „OTK" (2026-09-11)

Na prośbę Pawła: nazwa źródła wyświetlana w UI (chip filtra + odznaka na
karcie turnieju) zmieniona z „OTK" na „PZT" (`SOURCE_LABELS` w
`useTournaments.js`, `SOURCES` w `TournamentsPage.jsx`). Wartość w bazie
(`source='otk'`) i nazwy plików/komentarzy w kodzie zostają bez zmian —
to tylko kosmetyka wyświetlania, OTK to nadal właściwa nazwa kategorii
turniejowej PZT.

## Import Tennis Europe — potwierdzony na żywo (2026-09-11)

Workflow uruchomiony przez Pawła, zakończony sukcesem, dane widoczne w
appce: turnieje z Niemiec, Mołdawii i innych krajów, z prawdziwymi
zakresami dat, filtr krajów pokazuje 30+ pozycji po polsku. **Pierwsze
prawdziwe potwierdzenie działania od początku do końca.**

## ITF — sprawdzone, zostaje ręczne (2026-09-11)

Paweł podesłał link do kalendarza ITF, ale to była zła gałąź (World
Tennis Tour = dorosły tour zawodowy, nie junior). Znaleziony właściwy:
[world-tennis-tour-juniors-calendar](https://www.itftennis.com/en/tournament-calendar/world-tennis-tour-juniors-calendar/)
(kategorie J30–J300, polskie turnieje też tam są). Ma nawet czyste REST
API (`tennis/api/TournamentApi/GetCalendar?circuitCode=JT`, JSON,
świetna struktura danych z prawdziwymi datami start/koniec) — ale **strona
jest chroniona przez Imperva Incapsula** (prawdziwy system anty-bot,
wymagający rozwiązywania wyzwań JS). Pierwsze zapytanie przeszło
przypadkiem, każde kolejne — nawet z pełną sesją/ciasteczkami jak z
przeglądarki — zostało zablokowane.

**Decyzja: nie próbujemy tego obchodzić.** Świadome omijanie
zabezpieczeń strony trzeciej (w odróżnieniu od PZT/Tennis Europe, które
w ogóle nie mają takiej ochrony) ryzykowałoby trwałym zbanowaniem naszego
adresu IP (też z GitHub Actions) i jest inną kategorią działania niż
zwykłe scrapowanie otwartych stron. **ITF zostaje ręczne/przez
zgłoszenia** — zgodnie z pierwotnym planem z dokumentu założeń, teraz
już świadomie potwierdzonym, nie tylko domyślnie przyjętym. Jedyna
uczciwa droga do automatyzacji w przyszłości: oficjalne API partnerskie
ITF (nie sprawdzane, czy istnieje).

## Następne kroki

1. ~~Uzupełnić `.env`~~ / ~~uruchomić `0001_init.sql`~~ / ~~logowanie~~ /
   ~~ekran dodawania zawodnika~~ / ~~RLS na `accounts`~~ /
   ~~"Jadę na ten turniej" → trips~~ / ~~import turniejów OTK~~ /
   ~~Przejazdy~~ / ~~Noclegi~~ / ~~akceptacja próśb~~ / ~~Wiadomości~~ /
   ~~pełny test na dwóch kontach~~ / ~~edycja profilu~~ /
   ~~import Tennis Europe~~ / ~~sprawdzenie ITF~~ — zrobione i
   **import Tennis Europe potwierdzony na żywo** (patrz wyżej).
2. „Znajdź turniej po uczestniku z mojej okolicy" — kolejny kawałek pracy
   nad wyszukiwarką, jeszcze nie zaczęty (szkic wyżej, sekcja "Turnieje
   Tennis Europe").
3. Zgody i historia wyjazdów w profilu rodzica (`consents` w bazie już
   istnieje, nic jej jeszcze nie zasila) — czeka pośrednio na prawnika
   (treść zgody musi pochodzić z regulaminu, którego jeszcze nie mamy).
4. Możliwość **wycofania własnej prośby** o dołączenie (RLS już na to
   pozwala, `for delete` w 0007, UI jeszcze nie ma przycisku).
5. Znaleźć prawnika do regulaminu/polityki prywatności/DPIA — zanim ruszy
   zamknięta beta z udziałem osób spoza ATZ.
