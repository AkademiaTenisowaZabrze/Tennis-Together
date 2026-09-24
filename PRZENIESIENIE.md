# Przeniesienie Tennis Together na konta Akademii

Docelowo (jak w platformie ATZ): GitHub `AkademiaTenisowaZabrze`, Supabase w
organizacji "Akademia Tenisowa Zabrze", Firebase pod kontem
zabrzetenisowaakademia@gmail.com.

Wybrana droga to **przeniesienie istniejących zasobów**, a nie zakładanie
nowych. Dzięki temu adres i klucze Supabase, baza, użytkownicy, Edge Function
i Firebase zostają bez zmian. Zmienia się tylko adres GitHub Pages.

Kod jest już przygotowany: adresy stron i APK wyliczają się z konta/repo
(workflowy, `docs/config.js`), więc po przeniesieniu repo nie trzeba niczego
poprawiać w plikach.

## 1. Supabase (projekt `tennis-together`)

1. Konto akademii (Supabase → organizacja "Akademia Tenisowa Zabrze" → Team):
   zaproś `pmesznik@gmail.com` jako **Owner**.
2. Jako pmesznik zaakceptuj zaproszenie.
3. Projekt `tennis-together` → Settings → General → **Transfer project** →
   wybierz organizację akademii. (Plan Free: limit 2 projektów w organizacji,
   ATZ zajmuje jeden, więc się mieści.)
4. Klucze i adres zostają te same, nic w kodzie nie zmieniasz.

## 2. GitHub (repo `Tennis-Together`)

1. Jako pmesznik: repo → Settings → General → Danger Zone → **Transfer** →
   nowy właściciel `AkademiaTenisowaZabrze`, nazwa bez zmian.
2. Konto akademii akceptuje przeniesienie (mail / powiadomienie).
   Sekrety Actions, Releases i historia przenoszą się razem z repo.
3. W nowym repo: Settings → Pages → Source = **GitHub Actions**
   (workflow `Deploy Web` publikuje aplikację w `/app/` i strony z `docs/`).
4. Lokalnie: `git remote set-url origin https://github.com/AkademiaTenisowaZabrze/Tennis-Together.git`
   (zapisane w komputerze poświadczenia konta akademii pozwolą pushować).
5. Nowe adresy:
   - aplikacja: `https://akademiatenisowazabrze.github.io/Tennis-Together/app/`
   - testerzy: `https://akademiatenisowazabrze.github.io/Tennis-Together/testerzy.html`
   - APK: `https://github.com/AkademiaTenisowaZabrze/Tennis-Together/releases/download/debug-latest/tennis-together-debug-latest.apk`
   Stare adresy `github.io/pmesznik/...` przestaną działać (GitHub przekierowuje
   tylko adresy repo, nie stron). Trzeba wysłać testerom nowy link.
6. **Supabase → Authentication → URL Configuration → Redirect URLs**: zamień
   wpisy `https://pmesznik.github.io/Tennis-Together/...` na
   `https://akademiatenisowazabrze.github.io/Tennis-Together/**`.
   Bez tego link z maila potwierdzającego znowu pokaże błąd.
7. APK: ten sam pakiet i ten sam klucz podpisu, więc nowa wersja instaluje się
   jako aktualizacja.

## 3. Firebase (`tennis-together-e3c9d`)

Console → Project settings → Users and permissions → dodaj
zabrzetenisowaakademia@gmail.com jako **Owner**. Nic w kodzie ani w sekretach
się nie zmienia, powiadomienia działają dalej.

## 4. Administrator w aplikacji

Obecny admin to `pmesznik@gmail.com`. Żeby dać uprawnienia kontu akademii:
zarejestruj je w aplikacji (limit 2 rejestracji na godzinę), potem w Supabase
SQL Editor:

```sql
update accounts set is_admin = true
where id = (select id from auth.users where email = 'zabrzetenisowaakademia@gmail.com');
```

## 5. E-mail (odblokowuje też edycję szablonu maila)

Tak jak w ATZ: własny SMTP przez Gmail konta akademii, bez kupowania domeny.
Supabase → Authentication → Emails → SMTP Settings: host `smtp.gmail.com`,
port `465`, użytkownik zabrzetenisowaakademia@gmail.com, hasło to **hasło
aplikacji Google** (konto Google → Bezpieczeństwo → Weryfikacja dwuetapowa →
Hasła aplikacji). Hasło wpisujesz Ty, ja go nie znam. Limit to ok. 500 maili
na dobę.

Po włączeniu SMTP da się edytować szablon: wklej `docs/szablon-maila-potwierdzenie.html`
i ustaw temat `🎾 Potwierdź e-mail — Tennis Together`.

## Wariant B: nowy projekt Supabase zamiast transferu

`python scripts/build_setup_sql.py --url https://NOWY.supabase.co --key sb_publishable_...`
generuje jeden plik `supabase/setup/full_setup.sql` z migracjami 0001-0024 do
wklejenia w SQL Editor. Potem trzeba: wgrać Edge Function `notify-tournament`
i jej sekrety, ustawić zmienne repo `SUPABASE_URL` i `SUPABASE_ANON_KEY`
(Settings → Secrets and variables → Actions → Variables), zmienić adres w
`docs/config.js` i dodać `SUPABASE_SERVICE_ROLE_KEY` dla importu turniejów.
Konta użytkowników się nie przenoszą.
