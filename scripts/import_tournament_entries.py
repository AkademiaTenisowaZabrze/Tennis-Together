#!/usr/bin/env python3
"""
Import oficjalnej listy startowej PZT (po selekcji) dla turniejów OTK do
tabeli `tournament_entries` w Supabase.

Scrapuje portal.pzt.pl BEZPOŚREDNIO (ten sam wzorzec co
scripts/import_tournaments.py) — celowo NIE korzysta z API projektu
"NOWA APLIKACJA PZT ANDROID" hostowanego na Railway: ten hosting został
tam porzucony (limit 5$ szybko się wyczerpywał), więc oparcie nowej,
stałej funkcji Tennis Together o niego byłoby budowaniem na czymś, co już
raz uznaliśmy za zbyt kosztowne. Logika parsowania jest portem funkcji
scrape_tournament_status() / scrape_tournament_acceptance_list() z
pzt_player_scraper.py w tamtym projekcie.

Sprawdzane są tylko turnieje OTK z prawdziwym identyfikatorem PZT (nie
"SYN-..." — te jeszcze nie mają strony na portal.pzt.pl) i z datą startu
w rozsądnym oknie w przyszłości. Lista jest importowana DOPIERO gdy
TournamentResults.aspx pokaże link do listy selekcji — to jest właśnie
"moment po selekcji", o który chodziło. Zapisujemy zawodników z sekcji
"główny turniej" i "kwalifikacje" (oni na pewno jadą) — pomijamy listę
rezerwową (nie jest jeszcze pewne, że pojadą).

Wymaga zmiennych środowiskowych:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY   (jak w import_tournaments.py — omija RLS)

Uruchamiane przez .github/workflows/import-tournament-entries.yml, działa
też lokalnie: `python scripts/import_tournament_entries.py`.
"""
from __future__ import annotations

import os
import re
import sys
import time
from datetime import date, timedelta

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
WINDOW_DAYS = 60  # ile dni w przod sprawdzamy (selekcja pojawia sie blizej terminu)
MAX_TOURNAMENTS = 200  # bezpiecznik, zeby jeden przebieg nie trwal w nieskonczonosc
KEEP_SECTIONS = {"main", "qualifying"}  # bez listy rezerwowej - nie jest pewne, ze pojada


def _normalize(s: str) -> str:
    return (
        (s or "")
        .lower()
        .replace("ą", "a").replace("ć", "c").replace("ę", "e")
        .replace("ł", "l").replace("ń", "n").replace("ó", "o")
        .replace("ś", "s").replace("ź", "z").replace("ż", "z")
    )


def _clean_key(raw: str) -> str:
    # Patrz komentarz w import_tournaments.py - sekrety wklejone "na oko" do
    # GitHub Secrets czasem maja dolaczony bialy znak.
    return re.sub(r"\s+", "", raw)


def fetch_candidate_tournaments(supabase_url: str, service_role_key: str) -> list[dict]:
    today = date.today().isoformat()
    until = (date.today() + timedelta(days=WINDOW_DAYS)).isoformat()
    resp = requests.get(
        f"{supabase_url}/rest/v1/tournaments",
        headers={"apikey": service_role_key, "Authorization": f"Bearer {service_role_key}"},
        params={
            "select": "id,external_id,name,starts_on",
            "source": "eq.otk",
            "and": f"(starts_on.gte.{today},starts_on.lte.{until})",
            "order": "starts_on.asc",
            "limit": str(MAX_TOURNAMENTS),
        },
        timeout=30,
    )
    resp.raise_for_status()
    rows = resp.json()
    # Turnieje bez prawdziwego ID PZT (jeszcze nieogloszone na portalu) nie
    # maja strony z selekcja do sprawdzenia.
    return [r for r in rows if r.get("external_id") and not r["external_id"].startswith("SYN-")]


def acceptance_list_published(tournament_id: str, timeout: int = 15) -> bool:
    """Port scrape_tournament_status() - tylko flaga 'acceptance'."""
    url = f"{PZT_BASE}/TournamentResults.aspx?TournamentID={tournament_id}"
    resp = requests.get(url, headers=HEADERS, timeout=timeout)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    page_text_norm = _normalize(soup.get_text(" ", strip=True))
    if "odwolany" in page_text_norm or "turniej anulowany" in page_text_norm:
        return False

    for a in soup.find_all("a", href=True):
        href = a.get("href", "")
        if "void" in href:
            continue
        if "TournamentAcceptanceList" in href:
            return True
    return False


def _section_code(label: str) -> str:
    low = _normalize(label)
    if "rezerw" in low:
        return "reserve"
    if "elimin" in low or "kwalif" in low:
        return "qualifying"
    if "glown" in low or "dopuszcz" in low or "zaakceptowani" in low:
        return "main"
    return ""


def _parse_acceptance_table(soup: BeautifulSoup) -> tuple[str, list[dict]]:
    """Port _parse_acceptance_table() z pzt_player_scraper.py."""
    category_label = ""
    for el in soup.find_all(string=lambda t: t and "Kategoria:" in t):
        category_label = el.strip()
        break

    tables = soup.find_all("table")
    main_table = max(tables, key=lambda t: len(t.find_all("tr")), default=None)

    players: list[dict] = []
    current_section = "main"
    if main_table:
        for row in main_table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            texts = [c.get_text(strip=True) for c in cells]

            if len(cells) == 1:
                sec = _section_code(texts[0])
                if sec:
                    current_section = sec
                continue

            if len(cells) < 8:
                continue
            if texts[0].lower().startswith("lp"):
                continue

            pos_raw = texts[0].rstrip(".")
            is_wc = pos_raw.upper() == "WC"
            if not pos_raw.isdigit() and not is_wc:
                continue

            login_cell = cells[1]
            login_link = login_cell.find("a")
            player_login = ""
            if login_link:
                href = login_link.get("href", "")
                m = re.search(r"UserID=([A-Z0-9]+)", href, re.I)
                if m:
                    player_login = m.group(1).upper()
            if not player_login:
                player_login = texts[1]
            if not player_login:
                continue

            last_name, first_name, age_str, club, ranking_str = texts[2], texts[3], texts[4], texts[5], texts[7]
            try:
                age = int(age_str)
            except ValueError:
                age = None
            try:
                ranking = int(ranking_str)
            except ValueError:
                ranking = None

            players.append(
                {
                    "login": player_login,
                    "full_name": f"{last_name} {first_name}".strip(),
                    "club": club or None,
                    "age": age,
                    "ranking": ranking,
                    "section": current_section,
                }
            )

    cat_low = _normalize(category_label)
    gender_c = "G" if ("dziewcz" in cat_low or "kobiet" in cat_low) else ("B" if ("chlop" in cat_low or "mezcz" in cat_low) else "")
    type_c = "D" if ("podwojn" in cat_low or "debl" in cat_low) else "S"
    age_m = re.search(r"do\s*(\d+)", cat_low)
    category_code = f"{gender_c}{type_c}{age_m.group(1)}" if (gender_c and age_m) else ""

    return category_code, players


def scrape_acceptance_for_gender(tournament_id: str, gender: str, timeout: int = 20) -> tuple[str, list[dict]]:
    """
    Port scrape_tournament_acceptance_list() — strona uzywa ASP.NET WebForms
    postback do przelaczenia kategorii (dropdown ddlEventTournament).
    gender: "K" (dziewczeta) albo "M" (chlopcy).
    """
    base_url = f"{PZT_BASE}/TournamentAcceptanceList.aspx?TournamentID={tournament_id}"
    sess = requests.Session()
    resp = sess.get(base_url, headers=HEADERS, timeout=timeout)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    sel_el = soup.find("select", {"name": "ctl00$cphMainContainer$ddlEventTournament"})
    if not sel_el:
        # Brak dropdown - prawdopodobnie tylko jedna kategoria; parsuj od razu.
        return _parse_acceptance_table(soup)

    options: dict[str, str] = {}
    selected_label = ""
    for opt in sel_el.find_all("option"):
        label = opt.get_text(strip=True)
        options[label] = opt.get("value", "")
        if opt.get("selected"):
            selected_label = label

    prefix = "G" if gender == "K" else ("B" if gender == "M" else "")
    singles = [(lb, vl) for lb, vl in options.items() if len(lb) >= 2 and lb[1] == "S" and (not prefix or lb[0] == prefix)]
    if singles:
        target_label, target_value = singles[0]
    else:
        any_gender = [(lb, vl) for lb, vl in options.items() if not prefix or (lb and lb[0] == prefix)]
        target_label, target_value = any_gender[0] if any_gender else (selected_label, options.get(selected_label, ""))

    if target_label and target_label != selected_label and target_value:
        def _hv(name):
            el = soup.find("input", {"name": name})
            return el["value"] if el else ""

        post_data = {
            "__EVENTTARGET": "ctl00$cphMainContainer$ddlEventTournament",
            "__EVENTARGUMENT": "",
            "__LASTFOCUS": "",
            "__VIEWSTATE": _hv("__VIEWSTATE"),
            "__VIEWSTATEGENERATOR": _hv("__VIEWSTATEGENERATOR"),
            "__SCROLLPOSITIONX": _hv("__SCROLLPOSITIONX"),
            "__SCROLLPOSITIONY": _hv("__SCROLLPOSITIONY"),
            "ctl00$cphMainContainer$ddlEventTournament": target_value,
        }
        ev = _hv("__EVENTVALIDATION")
        if ev:
            post_data["__EVENTVALIDATION"] = ev
        resp2 = sess.post(
            base_url,
            data=post_data,
            headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded", "Referer": base_url},
            timeout=timeout,
        )
        resp2.raise_for_status()
        soup = BeautifulSoup(resp2.text, "html.parser")

    return _parse_acceptance_table(soup)


def fetch_entries(tournament_id: str) -> list[dict]:
    if not acceptance_list_published(tournament_id):
        return []

    rows: list[dict] = []
    for gender in ("K", "M"):
        try:
            category_code, players = scrape_acceptance_for_gender(tournament_id, gender)
        except Exception as exc:
            print(f"  [{tournament_id}] blad listy ({gender}): {exc}", file=sys.stderr)
            continue
        for p in players:
            if p["section"] not in KEEP_SECTIONS:
                continue
            rows.append(
                {
                    "pzt_login": p["login"],
                    "full_name": p["full_name"] or p["login"],
                    "gender": gender,
                    "category_code": category_code or None,
                    "club": p["club"],
                    "age": p["age"],
                    "ranking": p["ranking"],
                }
            )
    return rows


def upsert_entries(tournament_uuid: str, rows: list[dict], supabase_url: str, service_role_key: str) -> None:
    if not rows:
        return
    payload = [{**r, "tournament_id": tournament_uuid} for r in rows]
    resp = requests.post(
        f"{supabase_url}/rest/v1/tournament_entries",
        params={"on_conflict": "tournament_id,pzt_login"},
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        json=payload,
        timeout=30,
    )
    if not resp.ok:
        print(f"  Supabase odpowiedzial {resp.status_code}: {resp.text[:400]}", file=sys.stderr)
    resp.raise_for_status()


def main() -> int:
    supabase_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    service_role_key = _clean_key(os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""))
    if not supabase_url or not service_role_key:
        print("Brak SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY w srodowisku.", file=sys.stderr)
        return 1

    try:
        candidates = fetch_candidate_tournaments(supabase_url, service_role_key)
    except Exception as exc:
        print(f"Nie udalo sie pobrac listy turniejow: {exc}", file=sys.stderr)
        return 1

    print(f"Sprawdzam selekcje dla {len(candidates)} turniejow OTK w najblizszych {WINDOW_DAYS} dniach.")

    published = 0
    errors = 0
    for t in candidates:
        try:
            rows = fetch_entries(t["external_id"])
        except Exception as exc:
            # portal.pzt.pl bywa chwilowo niedostepny - nie przerywamy calego
            # importu z powodu jednego turnieju.
            print(f"  [{t['name']}] blad pobierania: {exc}", file=sys.stderr)
            errors += 1
            continue
        if not rows:
            continue
        upsert_entries(t["id"], rows, supabase_url, service_role_key)
        published += 1
        print(f"  [{t['name']}] selekcja opublikowana - zapisano {len(rows)} zawodnikow")
        time.sleep(0.5)  # nie zasypujemy portal.pzt.pl seria zapytan pod rzad

    print(f"Gotowe - selekcja znaleziona dla {published} turniejow, bledow: {errors}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
