# notify-tournament — wdrożenie

Ta funkcja wysyła powiadomienia push, gdy ktoś doda ofertę przejazdu lub
noclegu, do wszystkich innych zgłoszonych na ten sam turniej. Kod jest
gotowy, ale wymaga jednorazowej konfiguracji Firebase — to jedyna część
tej funkcji, której nie da się zrobić bez Twojego konta Google.

## 1. Załóż projekt Firebase (darmowy plan Spark wystarczy)

1. Wejdź na [console.firebase.google.com](https://console.firebase.google.com) → **Dodaj projekt**.
2. Nazwij dowolnie (np. "Tennis Together"). Statystyki Google Analytics — nieobowiązkowe, można wyłączyć.

## 2. Dodaj aplikację Androida do projektu

1. W panelu projektu kliknij ikonę Androida ("Dodaj aplikację").
2. **Nazwa pakietu (Android package name)** musi być dokładnie:
   ```
   pl.tennistogether.app
   ```
3. Pobierz plik **`google-services.json`** i wgraj go do repo pod ścieżką:
   ```
   android/app/google-services.json
   ```
   (Ten plik jest w `.gitignore` — nie trafi do repo automatycznie. Do
   lokalnego builda wystarczy go tam wkleić. Do builda w GitHub Actions —
   patrz punkt 5 niżej.)

## 3. Wygeneruj klucz konta serwisowego (do wysyłki z serwera)

1. W konsoli Firebase: **Ustawienia projektu** (ikona zębatki) → **Konta usługi** (Service accounts).
2. Kliknij **Wygeneruj nowy klucz prywatny** — pobierze się plik `.json`.
3. Ten plik zawiera prywatny klucz — **nigdy nie commituj go do repo**.

## 4. Ustaw sekrety Edge Function w Supabase

Wymaga [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm install -g supabase`, potem `supabase login`).

```bash
supabase link --project-ref jrabxtiranllayerhutm

supabase secrets set FIREBASE_PROJECT_ID=twoj-project-id-z-firebase

# Cała zawartość pobranego pliku klucza konta serwisowego, jako jeden
# ciąg JSON (Windows PowerShell):
supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON="$(Get-Content -Raw sciezka-do-pliku.json)"
```

## 5. Wdróż samą funkcję

```bash
supabase functions deploy notify-tournament
```

Od tego momentu każda nowa oferta przejazdu/noclegu w aplikacji
automatycznie wywoła tę funkcję (przez trigger bazy danych, patrz
`0020_push_notifications.sql`) i wyśle push do wszystkich zgłoszonych na
ten sam turniej.

## 6. (Opcjonalnie, ale zalecane) Dodaj google-services.json do builda CI

Bez tego kroku **lokalny** build z plikiem z punktu 2 będzie miał
działające powiadomienia, ale APK budowany przez GitHub Actions — nie
(świeży checkout repo za każdym razem, plik z `.gitignore` nie trafia na
maszynę CI).

1. Zakoduj plik do base64 (PowerShell):
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("google-services.json")) | Set-Clipboard
   ```
2. Wklej jako nowy sekret repo: **Settings → Secrets and variables → Actions → New repository secret**, nazwa `GOOGLE_SERVICES_JSON_BASE64`.
3. Powiedz mi, jak to zrobisz — dopiszę krok w workflow (`android-debug-apk.yml` i `android-build.yml`), który odtworzy plik z tego sekretu przed buildem (dokładnie ten sam wzorzec, którego już używamy do stałego `debug.keystore`).

## Jak to sprawdzić, że działa

1. Zainstaluj świeży APK (po kroku 2) na dwóch telefonach/kontach.
2. Zaloguj się na obu, dodaj zawodnika, zgłoś wyjazd na TEN SAM turniej na obu kontach.
3. Na koncie A dodaj ofertę przejazdu.
4. Konto B powinno dostać powiadomienie push w ciągu kilku sekund.

Jeśli nie przyjdzie: sprawdź logi funkcji (`supabase functions logs notify-tournament`) — najczęstsze przyczyny to zły `FIREBASE_PROJECT_ID`, źle wklejony JSON konta serwisowego, albo brak zapisanego tokenu urządzenia w tabeli `device_tokens` (dzieje się to dopiero po zaakceptowaniu uprawnień do powiadomień w apce na telefonie).

## Sekret wywołań (zalecane, audyt 2026-10-03)

Funkcję wołają triggery bazy, workflow przypomnień i skrypt importu. Żeby nie dało się jej
uruchomić samym publicznym kluczem, wprowadzono wspólny sekret (migracja `0045`). Kolejność:

1. Wymyśl sekret (np. 40 losowych znaków).
2. SQL Editor: `insert into private_config(key, value) values ('notify_webhook_secret', '<SEKRET>') on conflict (key) do update set value = excluded.value;`
3. GitHub: Settings > Secrets and variables > Actions > **NOTIFY_WEBHOOK_SECRET** (ten sam sekret; używa go workflow przypomnień i import wpisów PZT).
4. Na końcu: `supabase secrets set NOTIFY_WEBHOOK_SECRET=<SEKRET>` i `supabase functions deploy notify-tournament`.

Dopóki w kroku 4 nie ustawisz sekretu, funkcja działa jak dotąd (bez sprawdzania). Po kroku 4 żądania
bez nagłówka `x-webhook-secret` dostają 401.
