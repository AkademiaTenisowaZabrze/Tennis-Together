#!/usr/bin/env python3
"""
Import oficjalnej listy startowej PZT (po selekcji) dla turniejów OTK do
tabeli `tournament_entries` w Supabase.

Nie scrapuje portal.pzt.pl bezpośrednio — używa API projektu
"NOWA APLIKACJA PZT ANDROID" (FastAPI na Railway, ten sam co zasila
"Znajdź turniej po zawodniku" w aplikacji):
  GET /tournaments/{id}/status       -> {"acceptance": true/false, ...}
  GET /tournaments/{id}/acceptance?gender=K|M
      -> {"category_code": "...", "players": [{"login": "...", "full_name": "...",
          "club": "...", "age": ..., "ranking": ...}, ...]}

Sprawdzane są tylko turnieje OTK z prawdziwym identyfikatorem PZT (nie
"SYN-..." — te jeszcze nie mają strony na portal.pzt.pl) i z datą startu
w rozsądnym oknie w przyszłości (żeby nie odpytywać setek zeszłorocznych
turniejów). Lista PZT jest importowana DOPIERO gdy status zwróci
acceptance=true — to jest właśnie "moment po selekcji", o który chodziło.

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

PZT_RANKINGS_API = os.environ.get(
    "PZT_RANKINGS_API_URL", "https://pzt-rankingi-api-production.up.railway.app"
).rstrip("/")
WINDOW_DAYS = 60  # ile dni w przód sprawdzamy (selekcja pojawia się bliżej terminu)
MAX_TOURNAMENTS = 200  # bezpiecznik, żeby jeden przebieg nie trwał w nieskończoność


def _clean_key(raw: str) -> str:
    # Patrz komentarz w import_tournaments.py — sekrety wklejone "na oko" do
    # GitHub Secrets czasem mają dołączony biały znak.
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
    # Turnieje bez prawdziwego ID PZT (jeszcze nieogłoszone na portalu) nie
    # mają strony z selekcją do sprawdzenia.
    return [r for r in rows if r.get("external_id") and not r["external_id"].startswith("SYN-")]


def fetch_acceptance(tournament_id: str) -> list[dict]:
    status_resp = requests.get(f"{PZT_RANKINGS_API}/tournaments/{tournament_id}/status", timeout=20)
    status_resp.raise_for_status()
    if not status_resp.json().get("acceptance"):
        return []

    rows: list[dict] = []
    for gender in ("K", "M"):
        resp = requests.get(
            f"{PZT_RANKINGS_API}/tournaments/{tournament_id}/acceptance",
            params={"gender": gender},
            timeout=20,
        )
        if not resp.ok:
            print(f"  [{tournament_id}] blad pobierania listy ({gender}): HTTP {resp.status_code}", file=sys.stderr)
            continue
        data = resp.json()
        if data.get("error"):
            print(f"  [{tournament_id}] blad listy ({gender}): {data['error']}", file=sys.stderr)
            continue
        category_code = data.get("category_code")
        for p in data.get("players", []):
            login = (p.get("login") or "").strip()
            if not login:
                continue
            full_name = p.get("full_name") or f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
            rows.append(
                {
                    "pzt_login": login,
                    "full_name": full_name or login,
                    "gender": gender,
                    "category_code": category_code,
                    "club": p.get("club") or None,
                    "age": p.get("age"),
                    "ranking": p.get("ranking"),
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
            rows = fetch_acceptance(t["external_id"])
        except Exception as exc:
            # Serwis rankingow to osobny projekt (Railway) - jego chwilowa
            # awaria nie moze wywalic calego importu, tylko ten jeden turniej.
            print(f"  [{t['name']}] blad polaczenia z API rankingow: {exc}", file=sys.stderr)
            errors += 1
            continue
        if not rows:
            continue
        upsert_entries(t["id"], rows, supabase_url, service_role_key)
        published += 1
        print(f"  [{t['name']}] selekcja opublikowana - zapisano {len(rows)} zawodnikow")
        time.sleep(0.5)  # nie zasypujemy API rankingow seria zapytan pod rzad

    print(f"Gotowe - selekcja znaleziona dla {published} turniejow, bledow: {errors}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
