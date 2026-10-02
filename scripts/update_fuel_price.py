"""Aktualizuje cenę paliwa w kalkulatorze kosztów przejazdu (ride_cost_settings).

Źródło: oficjalny Biuletyn Paliwowy Komisji Europejskiej (Weekly Oil Bulletin,
"prices with taxes"). Plik XLSX zawiera średnie ceny detaliczne w EUR za
1000 litrów dla każdego kraju UE, w tym Polski. Przeliczamy je na złotówki
średnim kursem EUR z NBP (api.nbp.pl) i zapisujemy jako cenę za litr.

Biuletyn wychodzi co tydzień (dane z poniedziałku, publikacja w czwartek),
więc workflow odpala się w piątek. Skrypt niczego nie psuje po cichu:
 - gdy nie uda się pobrać/odczytać pliku, kurs albo wynik jest nieprawdopodobny
   (poza 3-15 zł/l), albo dane są starsze niż 21 dni - kończy się błędem
   (workflow robi się czerwony), a w bazie zostaje poprzednia cena;
 - gdy administrator wyłączył automat (fuel_price_auto = false), nic nie robi.

Wymaga zmiennych środowiskowych:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY   (klucz service_role - ominięcie RLS)
"""

from __future__ import annotations

import io
import os
import re
import sys
from datetime import date, datetime, timezone
from urllib.parse import unquote, urljoin

import requests
from bs4 import BeautifulSoup
import openpyxl

PAGE_URL = "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en"
NBP_EUR_URL = "https://api.nbp.pl/api/exchangerates/rates/a/eur/?format=json"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; TennisTogether/1.0)"}

# fuel_type w bazie -> fragment nagłówka kolumny w pliku Biuletynu
FUEL_HEADERS = {
    "pb95": "euro-super 95",
    "diesel": "gas oil automobile",
    "lpg": "lpg",
}
FUEL_LABELS = {"pb95": "benzyna 95", "diesel": "diesel", "lpg": "LPG"}

MAX_AGE_DAYS = 21
PRICE_MIN, PRICE_MAX = 3.0, 15.0


def find_bulletin_url() -> str:
    resp = requests.get(PAGE_URL, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for a in soup.find_all("a", href=True):
        href = unquote(a["href"])
        if "document/download" in href and "prices with taxes" in href.lower():
            return urljoin(PAGE_URL, a["href"])
    raise RuntimeError("Nie znaleziono linku do pliku 'prices with taxes' na stronie Biuletynu.")


def read_poland_prices(xlsx_bytes: bytes) -> tuple[dict[str, float], date | None]:
    """Zwraca ({fuel_type: EUR za 1000 l}, data biuletynu) dla Polski."""
    ws = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=True).active
    rows = list(ws.iter_rows(values_only=True))
    if len(rows) < 3:
        raise RuntimeError("Plik Biuletynu ma nieoczekiwany układ (za mało wierszy).")

    header = [str(c or "").strip().lower() for c in rows[0]]
    columns: dict[str, int] = {}
    for fuel, needle in FUEL_HEADERS.items():
        idx = next((i for i, h in enumerate(header) if needle in h), None)
        if idx is not None:
            columns[fuel] = idx

    bulletin_date = None
    first = rows[1][0] if len(rows) > 1 else None
    if isinstance(first, datetime):
        bulletin_date = first.date()

    poland = next((r for r in rows if r and isinstance(r[0], str) and r[0].strip().lower() == "poland"), None)
    if poland is None:
        raise RuntimeError("W pliku Biuletynu nie ma wiersza 'Poland'.")

    prices = {}
    for fuel, idx in columns.items():
        value = poland[idx]
        if isinstance(value, (int, float)) and value > 0:
            prices[fuel] = float(value)
    return prices, bulletin_date


def nbp_eur_rate() -> float:
    resp = requests.get(NBP_EUR_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return float(resp.json()["rates"][0]["mid"])


def main() -> int:
    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    key = re.sub(r"\s+", "", os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""))
    if not supabase_url or not key:
        print("Brak SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY w środowisku.", file=sys.stderr)
        return 1

    api = f"{supabase_url.rstrip('/')}/rest/v1/ride_cost_settings"
    sb_headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    resp = requests.get(api, headers=sb_headers, params={"select": "fuel_price_auto,fuel_type", "id": "eq.true"}, timeout=30)
    resp.raise_for_status()
    rows = resp.json()
    if not rows:
        print("Brak wiersza ustawień kalkulatora (czy migracje 0041/0042 są zastosowane?).", file=sys.stderr)
        return 1
    if not rows[0].get("fuel_price_auto", True):
        print("Automatyczna aktualizacja ceny paliwa wyłączona przez administratora - pomijam.")
        return 0
    fuel_type = rows[0].get("fuel_type") or "pb95"

    url = find_bulletin_url()
    print(f"Plik Biuletynu: {url}")
    file_resp = requests.get(url, headers=HEADERS, timeout=120)
    file_resp.raise_for_status()
    eur_prices, bulletin_date = read_poland_prices(file_resp.content)
    if fuel_type not in eur_prices:
        raise RuntimeError(f"Brak ceny dla rodzaju paliwa '{fuel_type}' w pliku Biuletynu.")

    if bulletin_date is None:
        raise RuntimeError("Nie udało się odczytać daty Biuletynu - nie ufam danym.")
    age = (date.today() - bulletin_date).days
    if age > MAX_AGE_DAYS:
        raise RuntimeError(f"Biuletyn jest za stary ({age} dni, z {bulletin_date}) - zostawiam poprzednią cenę.")

    rate = nbp_eur_rate()
    price = round(eur_prices[fuel_type] / 1000 * rate, 2)
    print(f"{FUEL_LABELS[fuel_type]}: {eur_prices[fuel_type]:.2f} EUR/1000 l x kurs NBP {rate} = {price} zł/l")
    if not (PRICE_MIN <= price <= PRICE_MAX):
        raise RuntimeError(f"Wynik {price} zł/l jest nieprawdopodobny (poza {PRICE_MIN}-{PRICE_MAX}) - nie zapisuję.")

    source = f"Biuletyn Paliwowy UE z {bulletin_date.isoformat()} ({FUEL_LABELS[fuel_type]}, kurs NBP {rate})"
    patch = requests.patch(
        api,
        headers={**sb_headers, "Prefer": "return=minimal"},
        params={"id": "eq.true"},
        json={
            "fuel_price_pln": price,
            "fuel_price_source": source,
            "fuel_price_updated_at": datetime.now(timezone.utc).isoformat(),
        },
        timeout=30,
    )
    patch.raise_for_status()
    print(f"Zapisano: {price} zł/l ({source})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
