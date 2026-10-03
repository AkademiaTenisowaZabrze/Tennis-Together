"""Testy skryptów importujących dane (bez sieci: wszystkie odpowiedzi są atrapami).

Uruchomienie:  python -m unittest discover -s tests/python -v
Wymaga pakietów ze scripts/requirements.txt (requests, beautifulsoup4, openpyxl).
"""

from __future__ import annotations

import io
import os
import sys
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import openpyxl  # noqa: E402

import import_tennis_europe as te  # noqa: E402
import import_tournaments as otk  # noqa: E402
import update_fuel_price as fuel  # noqa: E402


# ── pomocnicy: sztuczny plik Biuletynu Paliwowego UE ─────────────────────────
HEADER = [
    "in EUR",
    "Euro-super 95  (I)",
    "Gas oil automobile Automotive gas oil Dieselkraftstoff (I)",
    " Gas oil de chauffage Heating gas oil Heizöl (II)",
    " Fuel oil - Schweres Heizöl (III) Soufre ",
    " Fuel oil -Schweres Heizöl (III) Soufre > 1% Sulphur > 1% Schwefel > 1%",
    "GPL pour moteur LPG motor fuel",
]


def make_bulletin(bulletin_date: date | None, poland: list | None = (1852.7, 2060.3, 1712.5, 833.9, 632.7, 746.4)) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(HEADER)
    ws.append([datetime(bulletin_date.year, bulletin_date.month, bulletin_date.day) if bulletin_date else "brak", "1000 l", "1000 l", "1000 l", "t", "t", "1000 l"])
    ws.append(["Austria", 1956, 2259, 1859.47, None, None, None])
    if poland is not None:
        ws.append(["Poland", *poland])
    ws.append(["Portugal", 1800, 2100, None, None, None, None])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class FuelParserTests(unittest.TestCase):
    def test_czyta_ceny_polski_dla_trzech_paliw(self):
        prices, d = fuel.read_poland_prices(make_bulletin(date(2026, 9, 28)))
        self.assertEqual(set(prices), {"pb95", "diesel", "lpg"})
        self.assertAlmostEqual(prices["pb95"], 1852.7)
        self.assertAlmostEqual(prices["diesel"], 2060.3)
        self.assertAlmostEqual(prices["lpg"], 746.4)
        self.assertEqual(d, date(2026, 9, 28))

    def test_nie_myli_polski_z_innymi_krajami(self):
        prices, _ = fuel.read_poland_prices(make_bulletin(date(2026, 9, 28)))
        self.assertNotEqual(prices["pb95"], 1956)  # Austria
        self.assertNotEqual(prices["pb95"], 1800)  # Portugalia

    def test_brak_wiersza_polska_to_blad(self):
        with self.assertRaisesRegex(RuntimeError, "Poland"):
            fuel.read_poland_prices(make_bulletin(date(2026, 9, 28), poland=None))

    def test_wartosci_niepoprawne_sa_pomijane(self):
        prices, _ = fuel.read_poland_prices(make_bulletin(date(2026, 9, 28), poland=("n/a", 2060.3, None, None, None, 0)))
        self.assertNotIn("pb95", prices)
        self.assertNotIn("lpg", prices)
        self.assertIn("diesel", prices)

    def test_brak_daty_biuletynu_zwraca_none(self):
        _, d = fuel.read_poland_prices(make_bulletin(None))
        self.assertIsNone(d)

    def test_zbyt_malo_wierszy_to_blad(self):
        wb = openpyxl.Workbook()
        wb.active.append(["a"])
        buf = io.BytesIO()
        wb.save(buf)
        with self.assertRaises(RuntimeError):
            fuel.read_poland_prices(buf.getvalue())

    def test_link_do_pliku_jest_wyszukiwany_na_stronie(self):
        html = (
            '<a href="/document/download/aaa_en?filename=Weekly%20Oil%20Bulletin%20Weekly%20prices%20without%20taxes%20-%202024-02-19.xlsx">bez</a>'
            '<a href="/document/download/bbb_en?filename=Weekly%20Oil%20Bulletin%20Weekly%20prices%20with%20Taxes%20-%202026-09-21.xlsx">z podatkami</a>'
        )
        resp = mock.Mock(text=html, raise_for_status=lambda: None)
        with mock.patch.object(fuel.requests, "get", return_value=resp):
            url = fuel.find_bulletin_url()
        self.assertIn("/bbb_en", url)
        self.assertTrue(url.startswith("https://energy.ec.europa.eu/"))

    def test_brak_linku_to_czytelny_blad(self):
        resp = mock.Mock(text="<html></html>", raise_for_status=lambda: None)
        with mock.patch.object(fuel.requests, "get", return_value=resp):
            with self.assertRaisesRegex(RuntimeError, "Nie znaleziono linku"):
                fuel.find_bulletin_url()


class FuelMainTests(unittest.TestCase):
    """Pełny przebieg main() na atrapach sieci."""

    ENV = {"SUPABASE_URL": "https://test.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "klucz-testowy-123"}

    def run_main(self, *, settings, bulletin_date, eur_rate=4.3745, poland=(1852.7, 2060.3, 1712.5, 833.9, 632.7, 746.4)):
        patched = []
        xlsx = make_bulletin(bulletin_date, poland)

        def fake_get(url, **kw):
            r = mock.Mock()
            r.raise_for_status = lambda: None
            if "ride_cost_settings" in url:
                r.json = lambda: settings
            elif "weekly-oil-bulletin" in url:
                r.text = '<a href="/document/download/x_en?filename=Weekly%20prices%20with%20Taxes.xlsx">x</a>'
            elif "document/download" in url:
                r.content = xlsx
            elif "api.nbp.pl" in url:
                r.json = lambda: {"rates": [{"mid": eur_rate}]}
            else:
                raise AssertionError(f"nieoczekiwane zapytanie GET {url}")
            return r

        def fake_patch(url, **kw):
            patched.append(kw.get("json"))
            r = mock.Mock()
            r.raise_for_status = lambda: None
            return r

        with mock.patch.dict(os.environ, self.ENV), mock.patch.object(fuel.requests, "get", side_effect=fake_get), mock.patch.object(
            fuel.requests, "patch", side_effect=fake_patch
        ):
            code = fuel.main()
        return code, patched

    def test_swiezy_biuletyn_zapisuje_cene_pb95_przeliczona_na_zlote(self):
        code, patched = self.run_main(settings=[{"fuel_price_auto": True, "fuel_type": "pb95"}], bulletin_date=date.today() - timedelta(days=4))
        self.assertEqual(code, 0)
        self.assertEqual(len(patched), 1)
        self.assertEqual(patched[0]["fuel_price_pln"], round(1852.7 / 1000 * 4.3745, 2))
        self.assertIn("Biuletyn Paliwowy UE", patched[0]["fuel_price_source"])
        self.assertIn("fuel_price_updated_at", patched[0])

    def test_rodzaj_paliwa_diesel_uzywa_kolumny_diesla(self):
        code, patched = self.run_main(settings=[{"fuel_price_auto": True, "fuel_type": "diesel"}], bulletin_date=date.today() - timedelta(days=2))
        self.assertEqual(code, 0)
        self.assertEqual(patched[0]["fuel_price_pln"], round(2060.3 / 1000 * 4.3745, 2))

    def test_rodzaj_paliwa_lpg(self):
        _, patched = self.run_main(settings=[{"fuel_price_auto": True, "fuel_type": "lpg"}], bulletin_date=date.today() - timedelta(days=2))
        self.assertEqual(patched[0]["fuel_price_pln"], round(746.4 / 1000 * 4.3745, 2))

    def test_wylaczony_automat_nic_nie_zapisuje(self):
        code, patched = self.run_main(settings=[{"fuel_price_auto": False, "fuel_type": "pb95"}], bulletin_date=date.today())
        self.assertEqual(code, 0)
        self.assertEqual(patched, [])

    def test_biuletyn_starszy_niz_21_dni_nie_nadpisuje_ceny(self):
        with self.assertRaisesRegex(RuntimeError, "za stary"):
            self.run_main(settings=[{"fuel_price_auto": True, "fuel_type": "pb95"}], bulletin_date=date.today() - timedelta(days=30))

    def test_brak_daty_w_pliku_to_blad_zamiast_zgadywania(self):
        with self.assertRaisesRegex(RuntimeError, "daty Biuletynu"):
            self.run_main(settings=[{"fuel_price_auto": True, "fuel_type": "pb95"}], bulletin_date=None)

    def test_nieprawdopodobna_cena_nie_jest_zapisywana(self):
        with self.assertRaisesRegex(RuntimeError, "nieprawdopodobny"):
            self.run_main(settings=[{"fuel_price_auto": True, "fuel_type": "pb95"}], bulletin_date=date.today(), eur_rate=40)
        with self.assertRaisesRegex(RuntimeError, "nieprawdopodobny"):
            self.run_main(settings=[{"fuel_price_auto": True, "fuel_type": "pb95"}], bulletin_date=date.today(), eur_rate=0.1)

    def test_brak_wiersza_ustawien_konczy_sie_bledem(self):
        code, patched = self.run_main(settings=[], bulletin_date=date.today())
        self.assertEqual(code, 1)
        self.assertEqual(patched, [])

    def test_brak_kluczy_srodowiskowych_konczy_sie_bledem(self):
        with mock.patch.dict(os.environ, {"SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""}):
            self.assertEqual(fuel.main(), 1)

    def test_klucz_serwisowy_ze_spacjami_jest_czyszczony(self):
        seen = {}

        def fake_get(url, **kw):
            seen["headers"] = kw.get("headers", {})
            raise RuntimeError("stop")

        with mock.patch.dict(os.environ, {"SUPABASE_URL": "https://t.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": " abc\n def "}), mock.patch.object(
            fuel.requests, "get", side_effect=fake_get
        ):
            with self.assertRaises(RuntimeError):
                fuel.main()
        self.assertEqual(seen["headers"]["apikey"], "abcdef")

    def test_zakres_cen_jest_zgodny_z_ograniczeniem_w_bazie(self):
        # CHECK w ride_cost_settings: fuel_price_pln between 2 and 15
        self.assertGreaterEqual(fuel.PRICE_MIN, 2)
        self.assertLessEqual(fuel.PRICE_MAX, 15)


# ── scraper OTK (PZT) ───────────────────────────────────────────────────────
def otk_card(name, *, date_class="tournAppTopCent_B", date_text="Od: 2026.10.20", tid=None, city_line="42-600 Tarnowskie Góry, email x"):
    link = f'<a href="Results.aspx?TournamentID={tid}">wyniki</a>' if tid else ""
    return f"""
    <div class="tournAppContainer_B">
      <div class="tournAppName_B">{name}</div>
      <div class="{date_class}">{date_text}</div>
      <div>{city_line}</div>
      {link}
    </div>"""


class OtkScraperTests(unittest.TestCase):
    def scrape(self, html, category="U12"):
        sess = mock.MagicMock()
        r = mock.Mock(text=html, raise_for_status=lambda: None)
        sess.get.return_value = r
        sess.post.return_value = r
        with mock.patch.object(otk.requests, "Session", return_value=sess):
            return otk.scrape_category(category)

    def test_lapie_oba_warianty_klasy_daty_regresja_brakujacych_turniejow(self):
        html = (
            otk_card("Turniej zwykły", date_class="tournAppTopCent_B", tid="11111111-2222-3333-4444-555555555555")
            + otk_card("Turniej jasny", date_class="tournAppTopCent_B_light", date_text="Od: 2026.11.05", tid="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
        )
        rows = self.scrape(html)
        self.assertEqual([r["name"] for r in rows], ["Turniej zwykły", "Turniej jasny"])
        self.assertEqual(rows[1]["starts_on"], "2026-11-05")

    def test_data_z_zapasowego_elementu_gdy_brak_klasy_od(self):
        html = """<div class="tournAppContainer_B"><div class="tournAppName_B">Turniej</div>
                  <div class="tournAppTopRightConDate">2026-12-01</div></div>"""
        self.assertEqual(self.scrape(html)[0]["starts_on"], "2026-12-01")

    def test_wpis_bez_daty_jest_pomijany_a_nie_zgadywany(self):
        html = '<div class="tournAppContainer_B"><div class="tournAppName_B">Bez daty</div></div>'
        self.assertEqual(self.scrape(html), [])

    def test_wpis_bez_nazwy_jest_pomijany(self):
        html = '<div class="tournAppContainer_B"><div class="tournAppTopCent_B">Od: 2026.10.20</div></div>'
        self.assertEqual(self.scrape(html), [])

    def test_identyfikator_z_adresu_wyników_jest_wielkimi_literami(self):
        rows = self.scrape(otk_card("T", tid="abcdef12-3456-7890-abcd-ef1234567890"))
        self.assertEqual(rows[0]["external_id"], "ABCDEF12-3456-7890-ABCD-EF1234567890")

    def test_turniej_bez_wynikow_dostaje_stabilny_identyfikator_syntetyczny(self):
        a = self.scrape(otk_card("Memoriał X"))[0]["external_id"]
        b = self.scrape(otk_card("Memoriał X"))[0]["external_id"]
        c = self.scrape(otk_card("Memoriał Y"))[0]["external_id"]
        self.assertTrue(a.startswith("SYN-"))
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)

    def test_duplikaty_na_stronie_sa_scalane(self):
        html = otk_card("Ten sam") + otk_card("Ten sam")
        self.assertEqual(len(self.scrape(html)), 1)

    def test_wyciaga_miasto_z_adresu(self):
        rows = self.scrape(otk_card("T", city_line="42-600 Tarnowskie Góry, email a@b.pl"))
        self.assertEqual(rows[0]["city"], "Tarnowskie Góry")

    def test_kategoria_pochodzi_z_zapytania(self):
        for cat in ("U12", "U14", "U16", "U18"):
            self.assertEqual(self.scrape(otk_card("T"), cat)[0]["category"], cat)

    def test_nazwa_jest_normalizowana_z_bialych_znakow(self):
        rows = self.scrape(otk_card("  Turniej \n  z   odstępami "))
        self.assertEqual(rows[0]["name"], "Turniej z odstępami")

    def test_mapowanie_kategorii_obejmuje_cztery_grupy_wiekowe(self):
        self.assertEqual(set(otk.CATEGORY_IDS), {"U12", "U14", "U16", "U18"})

    def test_pelna_lista_z_wieloma_turniejami_nie_gubi_zadnego(self):
        html = "".join(
            otk_card(f"Turniej {i}", date_class="tournAppTopCent_B_light" if i % 2 else "tournAppTopCent_B", date_text=f"Od: 2026.10.{i + 1:02d}")
            for i in range(15)
        )
        self.assertEqual(len(self.scrape(html)), 15)


# ── Tennis Europe: karty z wynikami wyszukiwania ────────────────────────────
def te_card(title="Tennis Europe U12 Zabrze", href="/sport/tournament?id=ABCDEF12-3456", loc="Klub | ZABRZE, Poland", times=("2026-10-20T00:00:00", "2026-10-23T00:00:00"), tags=("12&U",)):
    t = "".join(f'<time datetime="{x}"></time>' for x in times)
    tg = "".join(f'<span class="tag">{x}</span>' for x in tags)
    return f"""<div class="media"><h4 class="media__title"><a href="{href}">{title}</a></h4>
      <div class="media__subheading"><img title="Poland"/>{loc}</div>{t}{tg}</div>"""


class TennisEuropeParserTests(unittest.TestCase):
    def test_parsuje_pelna_karte(self):
        rows = te.parse_cards(te_card())
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual(r["external_id"], "ABCDEF12-3456")
        self.assertEqual(r["city"], "Zabrze")
        self.assertEqual(r["country"], "Poland")
        self.assertEqual(r["category"], "U12")
        self.assertEqual((r["starts_on"], r["ends_on"]), ("2026-10-20", "2026-10-23"))
        self.assertTrue(r["website_url"].startswith("https://te.tournamentsoftware.com/"))

    def test_karta_bez_daty_jest_pomijana(self):
        self.assertEqual(te.parse_cards(te_card(times=())), [])

    def test_karta_bez_identyfikatora_jest_pomijana(self):
        self.assertEqual(te.parse_cards(te_card(href="/sport/tournament")), [])

    def test_bez_tagu_wieku_kategoria_pusta(self):
        self.assertIsNone(te.parse_cards(te_card(tags=("Boys",)))[0]["category"])

    def test_kategorie_wiekowe(self):
        for tag, expected in (("14&U", "U14"), ("16&U", "U16"), ("18&U", "U18"), ("10&U", "U10")):
            self.assertEqual(te.parse_cards(te_card(tags=(tag,)))[0]["category"], expected)

    def test_jedna_data_oznacza_brak_daty_konca(self):
        self.assertIsNone(te.parse_cards(te_card(times=("2026-10-20T00:00:00",)))[0]["ends_on"])

    def test_miasto_z_wielkich_liter_jest_zapisywane_ladnie(self):
        self.assertEqual(te.parse_cards(te_card(loc="Klub | BIELSKO-BIAŁA, Poland"))[0]["city"], "Bielsko-Biała")

    def test_pusty_dokument_daje_pusta_liste(self):
        self.assertEqual(te.parse_cards("<html></html>"), [])


# ── bezpieczeństwo skryptów ─────────────────────────────────────────────────
class ScriptSafetyTests(unittest.TestCase):
    def test_skrypty_nie_zawieraja_kluczy_w_kodzie(self):
        for f in (ROOT / "scripts").glob("*.py"):
            text = f.read_text(encoding="utf-8")
            self.assertNotRegex(text, r"sb_secret_[A-Za-z0-9_-]{10,}", f.name)
            self.assertNotRegex(text, r"eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}", f.name)

    def test_zapytania_do_bazy_ida_kluczem_z_zmiennej_srodowiskowej(self):
        for name in ("import_tournaments.py", "import_tennis_europe.py", "import_tournament_entries.py", "update_fuel_price.py"):
            text = (ROOT / "scripts" / name).read_text(encoding="utf-8")
            self.assertIn("SUPABASE_SERVICE_ROLE_KEY", text, name)
            self.assertIn("os.environ", text, name)

    def test_skrypty_odpytuja_tylko_znane_domeny(self):
        import re

        allowed = ("portal.pzt.pl", "te.tournamentsoftware.com", "energy.ec.europa.eu", "api.nbp.pl", "ec.europa.eu", "www.w3.org", "akademiatenisowazabrze.github.io")
        # smoke_test.py i build_setup_sql.py celowo odwołują się do własnej strony i GitHuba
        scripts = [f for f in (ROOT / "scripts").glob("*.py") if f.name not in ("smoke_test.py", "build_setup_sql.py")]
        for f in scripts:
            for m in re.finditer(r"https?://([a-z0-9.-]+)", f.read_text(encoding="utf-8")):
                host = m.group(1)
                if host.endswith(".supabase.co") or host == "xxxx.supabase.co" or "{" in host:
                    continue
                self.assertTrue(any(host == a or host.endswith("." + a) for a in allowed), f"{f.name}: {host}")

    def test_wszystkie_wywolania_sieci_maja_limit_czasu(self):
        import re

        def call_text(text, start):
            depth, i = 0, text.index("(", start)
            for j in range(i, len(text)):
                if text[j] == "(":
                    depth += 1
                elif text[j] == ")":
                    depth -= 1
                    if depth == 0:
                        return text[start : j + 1]
            return text[start:]

        for name in ("update_fuel_price.py", "import_tournaments.py", "import_tennis_europe.py", "import_tournament_entries.py"):
            text = (ROOT / "scripts" / name).read_text(encoding="utf-8")
            calls = list(re.finditer(r"requests\.(get|post|patch)\(|session\.(get|post)\(", text))
            self.assertGreater(len(calls), 0, name)
            for m in calls:
                self.assertIn("timeout", call_text(text, m.start()), f"{name}: wywołanie sieci bez timeout (znak {m.start()})")


if __name__ == "__main__":
    unittest.main()
