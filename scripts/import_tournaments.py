#!/usr/bin/env python3
"""
Import kalendarza turniejów OTK z portal.pzt.pl do tabeli `tournaments`
w Supabase.

Logika scrapowania jest uproszczonym portem funkcji scrape_tournaments_list()
z projektu "NOWA APLIKACJA PZT ANDROID" (pzt_player_scraper.py) — bez
logowania do PZT (anonimowa sesja daje ~10 publicznych OTK na kategorię,
co na start wystarcza, patrz PLAN.md) i bez pola "registration" (nieużywanego
w naszym schemacie).

Wymaga zmiennych środowiskowych:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY   (NIE anon/publishable key — upsert musi ominąć
                                RLS, które na `tournaments` blokuje zapis
                                każdemu poza service_role; patrz
                                supabase/migrations/0003_tournaments.sql)

Uruchamiane przez .github/workflows/import-tournaments.yml (cron + ręcznie),
ale działa też lokalnie: `python scripts/import_tournaments.py`.
"""
from __future__ import annotations

import hashlib
import os
import re
import sys
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

PZT_BASE = "https://portal.pzt.pl"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8",
}
CATEGORY_IDS = {"U12": 12, "U14": 14, "U16": 16, "U18": 18}


def scrape_category(category: str, timeout: int = 20) -> list[dict]:
    """Zwraca listę turniejów OTK dla jednej kategorii wiekowej."""
    cid = CATEGORY_IDS[category]
    url = f"{PZT_BASE}/Tournament.aspx?CategoryID={cid}"
    session = requests.Session()
    session.headers.update(HEADERS)

    r0 = session.get(url, timeout=timeout)
    r0.raise_for_status()
    soup0 = BeautifulSoup(r0.text, "html.parser")
    vs_el = soup0.find("input", {"name": "__VIEWSTATE"})
    vsg_el = soup0.find("input", {"name": "__VIEWSTATEGENERATOR"})

    if vs_el:
        # POST z pustym filtrem dat — pokazuje wszystkie dostępne turnieje
        # (bez logowania: publiczne OTK), tak jak w oryginalnym skrypcie.
        post_data = {
            "__EVENTTARGET": "",
            "__EVENTARGUMENT": "",
            "__VIEWSTATE": vs_el["value"],
            "__VIEWSTATEGENERATOR": vsg_el["value"] if vsg_el else "",
            "ctl00$cphMainContainer$ddlRank": "",
            "ctl00$cphMainContainer$txtNameTournament": "",
            "ctl00$cphMainContainer$ddlProvince": "",
            "ctl00$cphMainContainer$txtDateFrom": "",
            "ctl00$cphMainContainer$txtDateTo": "",
            "ctl00$cphMainContainer$btnSearch": "Szukaj",
        }
        resp = session.post(url, data=post_data, timeout=timeout)
        resp.raise_for_status()
    else:
        resp = r0

    soup = BeautifulSoup(resp.text, "html.parser")
    out: list[dict] = []
    seen: set[str] = set()

    for cont in soup.select(".tournAppContainer_B"):
        name_el = cont.select_one(".tournAppName_B")
        if not name_el:
            continue
        name = re.sub(r"\s+", " ", name_el.get_text(" ", strip=True)).strip()
        if not name:
            continue

        starts_on = None
        top_cent = cont.select_one(".tournAppTopCent_B")
        if top_cent:
            m = re.search(r"Od:\s*(\d{4})\.(\d{2})\.(\d{2})", top_cent.get_text())
            if m:
                starts_on = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
        if not starts_on:
            de = cont.select_one(".tournAppTopRightConDate")
            if de:
                m = re.search(r"\d{4}-\d{2}-\d{2}", de.get_text())
                if m:
                    starts_on = m.group(0)
        if not starts_on:
            # starts_on jest NOT NULL w schemacie — bez daty nie mamy co
            # zapisać, wolimy pominąć wpis niż zgadywać.
            continue

        tid_m = re.search(r"TournamentID=([0-9A-Fa-f]{8}-[0-9A-Fa-f\-]{27,35})", str(cont))
        if tid_m:
            external_id = tid_m.group(1).upper()
        else:
            # Turniej ogłoszony, jeszcze bez wyników — syntetyczne, ale
            # stabilne ID (ta sama nazwa+data zawsze da to samo ID, więc
            # kolejne uruchomienia importu robią update, nie duplikat).
            key = f"{name}|{starts_on}"
            external_id = "SYN-" + hashlib.sha1(key.encode("utf-8", errors="replace")).hexdigest()[:16].upper()

        if external_id in seen:
            continue
        seen.add(external_id)

        full_text = re.sub(r"\s+", " ", cont.get_text(" ", strip=True))
        city_m = re.search(
            r"\d{2}-\d{3}\s+([A-ZŁŚŻŹĆ][\wąćęłńóśżź .\-]+?)(?:,|\s{2}|\s+email|\s+www|\s+tel|\s+Uwagi|$)",
            full_text,
        )
        city = city_m.group(1).strip() if city_m else None

        out.append(
            {
                "external_id": external_id,
                "name": name,
                "city": city,
                "category": category,
                "starts_on": starts_on,
            }
        )

    return out


def upsert_tournaments(rows: list[dict], supabase_url: str, service_role_key: str) -> None:
    if not rows:
        return
    endpoint = f"{supabase_url.rstrip('/')}/rest/v1/tournaments"
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
        # merge-duplicates + on_conflict = prawdziwy upsert po unique(source, external_id)
        # (patrz supabase/migrations/0001_init.sql) zamiast błędu przy konflikcie.
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    payload = [
        {
            "source": "otk",
            "external_id": row["external_id"],
            "name": row["name"],
            "city": row["city"],  # może być None — kolumna jest nullable (0003)
            "country": "Polska",
            "category": row["category"],
            "starts_on": row["starts_on"],
            "ends_on": None,  # ten widok PZT nie podaje daty końca — lepiej
                               # pokazać "nieznana" niż zgadywać błędną datę
        }
        for row in rows
    ]
    resp = requests.post(
        endpoint,
        params={"on_conflict": "source,external_id"},
        headers=headers,
        json=payload,
        timeout=30,
    )
    if not resp.ok:
        print(f"  Supabase odpowiedział {resp.status_code}: {resp.text[:500]}", file=sys.stderr)
    resp.raise_for_status()


def mark_synced(key: str, count: int, supabase_url: str, service_role_key: str) -> None:
    # Baner "Dane zaktualizowano dziś o HH:MM" na Start (StartPage.jsx) czyta
    # ten wiersz — patrz supabase/migrations/0030_data_sync_status.sql.
    endpoint = f"{supabase_url.rstrip('/')}/rest/v1/data_sync_status"
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    resp = requests.post(
        endpoint,
        params={"on_conflict": "key"},
        headers=headers,
        json=[{"key": key, "last_synced_at": datetime.now(timezone.utc).isoformat(), "last_count": count}],
        timeout=30,
    )
    resp.raise_for_status()


def main() -> int:
    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    # Klucze API nigdy legalnie nie zawierają białych znaków — usuwamy
    # WSZYSTKIE (nie tylko na brzegach), żeby przypadkowy znak nowej linii
    # wklejony razem z sekretem w GitHub Secrets (częste przy kopiowaniu
    # "na oko" zamiast przyciskiem kopiowania) nie psuł nagłówka HTTP
    # niezrozumiałym błędem InvalidHeader.
    service_role_key = re.sub(r"\s+", "", os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""))
    if not supabase_url or not service_role_key:
        print("Brak SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY w środowisku.", file=sys.stderr)
        return 1

    total = 0
    for category in CATEGORY_IDS:
        try:
            rows = scrape_category(category)
        except Exception as exc:  # scraping strony trzeciej — nie przerywamy reszty kategorii
            print(f"[{category}] błąd scrapowania: {exc}", file=sys.stderr)
            continue
        print(f"[{category}] znaleziono {len(rows)} turniejów")
        upsert_tournaments(rows, supabase_url, service_role_key)
        total += len(rows)

    print(f"Gotowe — zaimportowano/zaktualizowano {total} wpisów (suma po 4 kategoriach, mogą się powtarzać).")
    mark_synced("tournaments_otk", total, supabase_url, service_role_key)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
