"""Testy czarnej skrzynki przeciwko żywej instancji, wyłącznie jako ANONIM (klucz publiczny).

Czego NIE robią: nie tworzą kont, nie zapisują danych, nie wywołują powiadomień.
Sprawdzają, że to, czego anonim zobaczyć lub zrobić nie powinien, jest zablokowane.

Uruchomienie:  python -m unittest discover -s tests/live -v
Bez internetu:  TT_OFFLINE=1 (testy zostaną pominięte).
Inny projekt:   TT_LIVE_URL=https://xxxx.supabase.co TT_LIVE_KEY=sb_publishable_...
"""

from __future__ import annotations

import json
import os
import re
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = (ROOT / "docs" / "config.js").read_text(encoding="utf-8")
URL = os.environ.get("TT_LIVE_URL") or re.search(r'supabaseUrl:\s*"([^"]+)"', CONFIG).group(1)
KEY = os.environ.get("TT_LIVE_KEY") or re.search(r'supabaseAnonKey:\s*"([^"]+)"', CONFIG).group(1)
SITE = "https://akademiatenisowazabrze.github.io/Tennis-Together"
OFFLINE = bool(os.environ.get("TT_OFFLINE"))
ZERO = "00000000-0000-0000-0000-000000000000"


def call(method, url, body=None, headers=None, timeout=30):
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", **(headers or {})}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace"), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), dict(e.headers)
    except Exception as e:  # sieć niedostępna itp.
        return 0, str(e), {}


def parse(body):
    try:
        return json.loads(body)
    except Exception:
        return None


def table_names():
    out = set()
    for f in (ROOT / "supabase" / "migrations").glob("*.sql"):
        out.update(re.findall(r"create table (?:if not exists )?(?:public\.)?([a-z_]+)", f.read_text(encoding="utf-8"), re.I))
    return sorted(out)


# Tabele, z których anonim może czytać z założenia: żadna (F4 zamknięte migracją 0044).
# Dopóki 0044 nie jest zastosowana w produkcji, testy live zgłoszą otwarty odczyt bug_reports/signup_attempts.
ANON_READABLE_BY_DESIGN = set()
ANON_READABLE_KNOWN = set()
ANON_WRITABLE_BY_DESIGN = {"bug_reports", "signup_attempts"}


@unittest.skipIf(OFFLINE, "TT_OFFLINE")
class AnonymousTableAccess(unittest.TestCase):
    def test_lista_tabel_z_migracji_jest_pelna(self):
        self.assertGreaterEqual(len(table_names()), 29)

    def test_anonim_nie_czyta_zadnej_tabeli_z_danymi(self):
        leaked = []
        for t in table_names():
            if t in ANON_READABLE_BY_DESIGN | ANON_READABLE_KNOWN:
                continue
            status, body, _ = call("GET", f"{URL}/rest/v1/{t}?select=*&limit=3")
            rows = parse(body)
            if status == 200 and isinstance(rows, list) and rows:
                leaked.append(f"{t}: {len(rows)} wierszy")
            self.assertNotIn(status, (500, 0), f"{t}: HTTP {status} {body[:80]}")
        self.assertEqual(leaked, [])

    def test_tabele_z_otwartym_odczytem_to_wylacznie_znane_luki(self):
        really_open = []
        for t in table_names():
            status, body, _ = call("GET", f"{URL}/rest/v1/{t}?select=*&limit=1")
            rows = parse(body)
            if status == 200 and isinstance(rows, list) and rows:
                really_open.append(t)
        self.assertTrue(set(really_open) <= ANON_READABLE_KNOWN | ANON_READABLE_BY_DESIGN, f"nowe otwarte tabele: {really_open}")

    def test_anonim_nie_zapisuje_do_tabel_z_danymi_osob(self):
        # Pusty obiekt = "domyślne wartości". Gdy RLS blokuje, baza odpowiada 403/42501 jeszcze przed
        # sprawdzeniem ograniczeń; gdyby RLS pozwolił, odpowiedź to 400 (puste NOT NULL), a nic i tak
        # nie zostaje zapisane. (Nieznana kolumna dałaby 400 niezależnie od RLS, więc jej nie używamy.)
        allowed = []
        for t in table_names():
            if t in ANON_WRITABLE_BY_DESIGN:
                continue
            status, body, _ = call("POST", f"{URL}/rest/v1/{t}", {})
            data = parse(body) or {}
            blocked = status in (401, 403) or data.get("code") == "42501"
            if not blocked:
                allowed.append(f"{t}: HTTP {status} {str(data)[:70]}")
        self.assertEqual(allowed, [])

    def test_anonim_nie_zmienia_ani_nie_usuwa_istniejacych_danych(self):
        for t in table_names():
            if t in ANON_WRITABLE_BY_DESIGN:
                continue
            col = "key" if t in ("data_sync_status", "push_throttle") else "city" if t == "city_coordinates" else "id"
            if t in ("conversation_participants", "blocks", "trip_group_members"):
                continue  # brak kolumny id; reszta tabel pokrywa ten sam mechanizm
            status, body, _ = call("PATCH", f"{URL}/rest/v1/{t}?{col}=eq.{ZERO}", {"id": ZERO}, {"Prefer": "return=representation"})
            rows = parse(body)
            self.assertFalse(status == 200 and isinstance(rows, list) and rows, f"{t}: zwrócono wiersze po PATCH")
            status, body, _ = call("DELETE", f"{URL}/rest/v1/{t}?{col}=eq.{ZERO}", None, {"Prefer": "return=representation"})
            rows = parse(body)
            self.assertFalse(status == 200 and isinstance(rows, list) and rows, f"{t}: zwrócono wiersze po DELETE")

    def test_anonim_moze_tylko_dopisac_zgloszenie_bledu_ale_nie_zmieni_ani_nie_usunie(self):
        status, body, _ = call("PATCH", f"{URL}/rest/v1/bug_reports?id=eq.{ZERO}", {"resolved": True}, {"Prefer": "return=representation"})
        self.assertFalse(status == 200 and parse(body))
        status, body, _ = call("DELETE", f"{URL}/rest/v1/bug_reports?id=eq.{ZERO}", None, {"Prefer": "return=representation"})
        self.assertFalse(status == 200 and parse(body))

    def test_pola_uprawnien_konta_nie_sa_osiagalne_dla_anonima(self):
        status, body, _ = call("GET", f"{URL}/rest/v1/accounts?select=id,is_admin,role,phone&limit=3")
        rows = parse(body)
        self.assertFalse(status == 200 and isinstance(rows, list) and rows)


@unittest.skipIf(OFFLINE, "TT_OFFLINE")
class AnonymousFunctions(unittest.TestCase):
    NOT_CALLABLE = {
        "confirm_meeting": {"p_request_id": ZERO, "p_kind": "ride", "p_code": "AAAAAA"},
        "set_meeting_point": {"p_kind": "ride", "p_request_id": ZERO, "p_lat": 50.0, "p_lng": 18.0, "p_place": "x"},
        "ride_cost_suggestion": {"p_trip_id": ZERO},
        "trip_arrangements": {},
        "find_pzt_tournament_matches": {"p_tournament_id": ZERO},
        "claim_push_slot": {"p_key": "x", "p_minutes": 1},
        "claim_coach_digests": {},
        "claim_trip_reminders": {"p_days": 1},
        "expire_stale_requests": {},
        "trip_ride_status": {"p_trip_id": ZERO},
        "trip_lodging_status": {"p_trip_id": ZERO},
    }

    def test_funkcje_zmieniajace_dane_lub_dla_service_role_nie_sa_dostepne_dla_anonima(self):
        exposed = []
        for name, args in self.NOT_CALLABLE.items():
            status, body, _ = call("POST", f"{URL}/rest/v1/rpc/{name}", args)
            data = parse(body)
            if status == 200 and data not in (None, [], {}, False):
                exposed.append(f"{name}: HTTP {status} {str(data)[:80]}")
            self.assertNotEqual(status, 500, f"{name}: błąd serwera {body[:80]}")
        self.assertEqual(exposed, [])

    def test_funkcje_pomocnicze_zwracaja_anonimowi_wartosci_negatywne(self):
        for name, args in (("is_admin", {}), ("account_is_active", {})):
            status, body, _ = call("POST", f"{URL}/rest/v1/rpc/{name}", args)
            if status == 200:
                self.assertIn(parse(body), (False, None), name)

    def test_admin_stats_odmawia_anonimowi(self):
        status, body, _ = call("POST", f"{URL}/rest/v1/rpc/admin_stats", {})
        self.assertNotEqual(status, 200, body[:100])

    def test_match_profile_nie_zwraca_anonimowi_nic(self):
        status, body, _ = call("POST", f"{URL}/rest/v1/rpc/match_profile", {"other_account_id": ZERO})
        if status == 200:
            self.assertEqual(parse(body), [])


@unittest.skipIf(OFFLINE, "TT_OFFLINE")
class AuthConfiguration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        status, body, _ = call("GET", f"{URL}/auth/v1/settings")
        cls.ok = status == 200
        cls.settings = parse(body) or {}

    def setUp(self):
        if not self.ok:
            self.skipTest("nie udało się pobrać ustawień uwierzytelniania")

    def test_potwierdzenie_adresu_email_jest_wymagane(self):
        self.assertFalse(self.settings.get("mailer_autoconfirm"), "konta powstają bez potwierdzenia e-maila")

    def test_logowanie_telefonem_i_zewnetrzni_dostawcy_sa_wylaczeni(self):
        ext = self.settings.get("external", {})
        enabled = [k for k, v in ext.items() if v and k not in ("email",)]
        self.assertEqual(enabled, [], f"włączeni dostawcy: {enabled}")
        self.assertFalse(self.settings.get("phone_autoconfirm"))

    def test_rejestracja_przez_email_jest_dostepna_zgodnie_z_zalozeniem_beta(self):
        self.assertFalse(self.settings.get("disable_signup"))
        self.assertTrue(self.settings.get("external", {}).get("email", True))

    def test_logowanie_anonimowe_jest_wylaczone(self):
        status, body, _ = call("POST", f"{URL}/auth/v1/signup", {})
        # pusta rejestracja ma być odrzucona (nie tworzy anonimowego użytkownika)
        self.assertNotEqual(status, 200, body[:120])

    def test_odzyskiwanie_hasla_nie_zdradza_czy_konto_istnieje(self):
        status_a, body_a, _ = call("POST", f"{URL}/auth/v1/recover", {"email": "na-pewno-nie-istnieje-xyz@example.com"})
        status_b, body_b, _ = call("POST", f"{URL}/auth/v1/recover", {"email": "inny-nie-istnieje-abc@example.com"})
        self.assertEqual(status_a, status_b)
        self.assertEqual(body_a, body_b)


@unittest.skipIf(OFFLINE, "TT_OFFLINE")
class StorageAccess(unittest.TestCase):
    def test_anonim_nie_wylistuje_zawartosci_kontenera_avatars(self):
        status, body, _ = call("POST", f"{URL}/storage/v1/object/list/avatars", {"prefix": "", "limit": 5})
        data = parse(body)
        self.assertFalse(status == 200 and isinstance(data, list) and data, f"widoczne pliki: {str(data)[:100]}")

    def test_anonim_nie_wgra_pliku(self):
        req = urllib.request.Request(
            f"{URL}/storage/v1/object/avatars/{ZERO}/test-anon.txt",
            data=b"x",
            method="POST",
            headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "text/plain"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                status = r.status
        except urllib.error.HTTPError as e:
            status = e.code
        self.assertNotEqual(status, 200)

    def test_kontenery_inne_niz_avatars_nie_istnieja_publicznie(self):
        status, body, _ = call("GET", f"{URL}/storage/v1/bucket")
        data = parse(body)
        self.assertFalse(status == 200 and isinstance(data, list) and data, f"widoczne kontenery: {str(data)[:100]}")


@unittest.skipIf(OFFLINE, "TT_OFFLINE")
class EdgeFunctions(unittest.TestCase):
    F = f"{URL}/functions/v1/notify-tournament"
    L = f"{URL}/functions/v1/pzt-player-lookup"

    def test_notify_odrzuca_zle_dane_zamiast_padac(self):
        cases = [
            {"event": "trip_reminders", "days": 3},
            {"event": "admin_report", "source": "x"},
            {"event": "meeting_confirmed", "request_kind": "ride_ping", "request_id": ZERO},
            {"event": "new_message", "message_id": ZERO},
            {"event": "club_trip_created", "trip_id": ZERO},
            {"event": "selection_published", "tournament_id": ZERO},
            {"event": "nieznane_zdarzenie"},
            {"event": 123},
            {},
        ]
        for body in cases:
            status, text, _ = call("POST", self.F, body)
            self.assertLess(status, 500, f"{body}: HTTP {status} {text[:100]}")

    def test_notify_odpowiada_na_zepsuty_json_bez_bledu_serwera(self):
        req = urllib.request.Request(self.F, data=b"{ to nie jest json", method="POST", headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                status = r.status
        except urllib.error.HTTPError as e:
            status = e.code
        self.assertEqual(status, 400)

    def test_notify_nie_ujawnia_sladu_stosu(self):
        _, text, _ = call("POST", self.F, {"event": "new_message", "message_id": ZERO})
        for needle in ("at file:///", "Deno.", "node_modules", ".ts:"):
            self.assertNotIn(needle, text)

    def test_notify_ignoruje_wielki_ladunek_bez_zawieszenia(self):
        t0 = time.time()
        status, _, _ = call("POST", self.F, {"event": "nieznane", "x": "A" * 200_000})
        self.assertLess(status, 500)
        self.assertLess(time.time() - t0, 20)

    def test_wyszukiwanie_loginu_pzt_obsluguje_dziwne_dane_bez_awarii_funkcji(self):
        for login in ("", "../../etc/passwd", "'; DROP TABLE x;--", "ŁĄĘ"):
            status, text, _ = call("POST", self.L, {"login": login}, timeout=40)
            self.assertIn(status, (400, 401, 403), f"login {login[:20]!r}: HTTP {status} {text[:80]}")

    def test_bardzo_dlugi_login_jest_odrzucany_bez_pytania_portalu(self):
        status, _, _ = call("POST", self.L, {"login": "A" * 3000}, timeout=40)
        self.assertIn(status, (400, 401))

    def test_wyszukiwanie_loginu_wymaga_zalogowania_klucz_publiczny_nie_wystarcza(self):
        # F5 (zamknięte): poprawny login od anonima nie może uruchomić zapytania do portalu PZT
        status, text, _ = call("POST", self.L, {"login": "MRO2043343"}, timeout=40)
        self.assertEqual(status, 401, f"HTTP {status} {text[:100]}")
        self.assertNotIn("Mroczek", text)

    def test_wyszukiwanie_loginu_pusty_login_nie_przechodzi(self):
        status, _, _ = call("POST", self.L, {"login": ""})
        self.assertIn(status, (400, 401))

    def test_preflight_cors_dziala_dla_aplikacji_webowej(self):
        status, _, headers = call("OPTIONS", self.L, None, {"Origin": SITE, "Access-Control-Request-Method": "POST"})
        self.assertIn(status, (200, 204))
        self.assertIn("access-control-allow-origin", {k.lower() for k in headers})


@unittest.skipIf(OFFLINE, "TT_OFFLINE")
class DeployedSite(unittest.TestCase):
    def test_strony_pomocnicze_sa_dostepne(self):
        for path in ("/admin.html", "/testerzy.html", "/dokumentacja.html", "/potwierdz-email.html", "/config.js", "/app/"):
            status, _, _ = call("GET", SITE + path, None, {"Authorization": "", "apikey": ""})
            self.assertEqual(status, 200, path)

    def test_korzen_strony_zwraca_kod_200(self):
        status, _, _ = call("GET", SITE + "/", None, {"Authorization": "", "apikey": ""})
        self.assertEqual(status, 200)

    def test_strona_dziala_po_https_i_http_przekierowuje(self):
        req = urllib.request.Request(SITE.replace("https://", "http://") + "/app/", method="GET")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                final = r.geturl()
        except Exception as e:
            self.skipTest(str(e))
        self.assertTrue(final.startswith("https://"))

    def test_konfiguracja_strony_wskazuje_ten_sam_projekt_co_testy(self):
        _, body, _ = call("GET", SITE + "/config.js")
        self.assertIn(URL, body)
        self.assertNotIn("sb_secret_", body)

    def test_wdrozona_aplikacja_zawiera_zwrot_kosztow_i_kalkulator(self):
        _, html, _ = call("GET", SITE + "/app/")
        asset = re.search(r'assets/index-[A-Za-z0-9_-]+\.js', html)
        self.assertIsNotNone(asset, "nie znaleziono pakietu JS na stronie aplikacji")
        _, js, _ = call("GET", f"{SITE}/app/{asset.group(0)}")
        self.assertIn("Zgadzam się i proszę o miejsce", js)
        self.assertIn("ride_cost_suggestion", js)

    def test_panel_admina_nie_zawiera_kluczy_serwisowych(self):
        _, body, _ = call("GET", SITE + "/admin.html")
        self.assertNotRegex(body, r"sb_secret_[A-Za-z0-9_-]{10,}")
        self.assertNotRegex(body, r"SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*[\"'][^\"']{20,}")

    def test_apk_do_pobrania_jest_dostepne(self):
        status, _, headers = call("GET", f"https://github.com/AkademiaTenisowaZabrze/Tennis-Together/releases/download/debug-latest/tennis-together-debug-latest.apk", None, {"Authorization": "", "apikey": ""}, timeout=60)
        self.assertEqual(status, 200)


if __name__ == "__main__":
    unittest.main()
