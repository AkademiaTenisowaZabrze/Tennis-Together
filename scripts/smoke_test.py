# -*- coding: utf-8 -*-
import json, urllib.request, urllib.error

U = "https://jrabxtiranllayerhutm.supabase.co"
K = "sb_publishable_8-yxyMhoEEq-kHx2opU0Pg_QylogBur"
PAGES = "https://akademiatenisowazabrze.github.io/Tennis-Together"
results = []


def call(method, url, body=None, headers=None):
    h = {"apikey": K, "Authorization": "Bearer " + K, "Content-Type": "application/json"}
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, str(e)


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (("  | " + detail) if detail else ""))


Z = "00000000-0000-0000-0000-000000000000"

# 1. Anon nie moze CZYTAC danych prywatnych (RLS: pusta lista lub blad, nigdy dane)
private_tables = ["accounts", "players", "trips", "ride_offers", "lodging_offers", "ride_join_requests",
                  "lodging_join_requests", "conversations", "messages", "consents", "trip_groups",
                  "trip_group_members", "reports", "blocks", "device_tokens", "ratings",
                  "lodging_host_offers", "lodging_host_requests"]
for t in private_tables:
    s, b = call("GET", f"{U}/rest/v1/{t}?select=*&limit=1")
    leaked = s == 200 and b.strip() not in ("[]", "")
    check(f"anon nie czyta tabeli {t}", not leaked, f"HTTP {s} {b[:60]}")

# 2. Anon nie moze ZAPISYWAC (insert powinien byc odrzucony)
inserts = {
    "accounts": {"id": Z, "role": "parent", "full_name": "x"},
    "consents": {"player_id": Z, "given_by_account_id": Z, "consent_type": "terms"},
    "trip_groups": {"tournament_id": Z, "created_by_account_id": Z},
    "tournaments": {"source": "itf", "name": "x", "starts_on": "2030-01-01"},
    "reports": {"reporter_account_id": Z, "reported_account_id": Z, "reason": "x"},
    "device_tokens": {"account_id": Z, "token": "x"},
    "ratings": {"join_request_id": Z, "join_request_kind": "ride", "rater_account_id": Z, "rated_account_id": Z, "stars": 5},
    "lodging_host_offers": {"tournament_id": Z, "host_account_id": Z, "city": "x"},
    "lodging_host_requests": {"host_offer_id": Z, "requester_trip_id": Z},
}
for t, body in inserts.items():
    s, b = call("POST", f"{U}/rest/v1/{t}", body, {"Prefer": "return=minimal"})
    check(f"anon nie zapisuje do {t}", s in (401, 403) or "row-level security" in b or s in (400, 404) and "violates" in b or s == 401, f"HTTP {s} {b[:80]}")

# 3. Tabele celowo publiczne
s, b = call("GET", f"{U}/rest/v1/signup_attempts?select=id&limit=1")
check("licznik rejestracji czytelny dla anon", s == 200, f"HTTP {s}")
s, b = call("GET", f"{U}/rest/v1/bug_reports?select=id&limit=1")
check("zgloszenia bledow czytelne dla anon (celowo)", s == 200, f"HTTP {s}")

# 4. Funkcje RPC nie moga zdradzac danych anonowi
for fn, body in [("admin_stats", {}), ("match_profile", {"other_account_id": Z}),
                 ("can_rate", {"p_join_request_id": Z, "p_kind": "ride", "p_other_account_id": Z})]:
    s, b = call("POST", f"{U}/rest/v1/rpc/{fn}", body)
    leaked = s == 200 and b.strip() not in ("[]", "null", "false", "")
    check(f"rpc {fn} nie zdradza danych anonowi", not leaked, f"HTTP {s} {b[:80]}")
s, b = call("POST", f"{U}/rest/v1/rpc/confirm_meeting", {"p_request_id": Z, "p_kind": "ride", "p_code": "AAAAAA"})
check("rpc confirm_meeting niedostepne dla anon (albo jeszcze nie wdrozone)", s in (401, 403, 404), f"HTTP {s} {b[:80]}")

s, b = call("POST", f"{U}/rest/v1/rpc/set_meeting_point", {"p_kind": "ride", "p_request_id": Z, "p_lat": 50.0, "p_lng": 19.0, "p_place": "x"})
check("rpc set_meeting_point niedostepne dla anon (albo jeszcze nie wdrozone)", s in (401, 403, 404), f"HTTP {s} {b[:80]}")
for fn in ("expire_stale_requests", "trip_arrangements"):
    s, b = call("POST", f"{U}/rest/v1/rpc/{fn}", {})
    check(f"rpc {fn} niedostepne dla anon (albo jeszcze nie wdrozone)", s in (401, 403, 404), f"HTTP {s} {b[:80]}")

# 5. Funkcja powiadomien
s, b = call("POST", f"{U}/functions/v1/notify-tournament", {"trip_id": Z, "offer_kind": "ride"})
check("funkcja powiadomien odpowiada", s in (200, 400, 404), f"HTTP {s} {b[:80]}")
s, b = call("POST", f"{U}/functions/v1/notify-tournament", {"trip_id": "x", "offer_kind": "zle"})
check("funkcja powiadomien odrzuca bledne dane (wymaga wdrozenia poprawki)", s == 400, f"HTTP {s} {b[:80]}")

# Push "prosba zaakceptowana" (0033) - zly rodzaj ma byc odrzucony
s, b = call("POST", f"{U}/functions/v1/notify-tournament", {"event": "request_accepted", "request_kind": "x", "request_id": "y"})
check("funkcja powiadomien odrzuca nieznany rodzaj prosby", s == 400, f"HTTP {s} {b[:80]}")

s, b = call("POST", f"{U}/functions/v1/notify-tournament", {"event": "meeting_point_set", "request_kind": "lodging", "request_id": "x"})
check("powiadomienie o pineski odrzuca nieobslugiwany rodzaj", s == 400, f"HTTP {s} {b[:80]}")

# Weryfikacja loginu PZT (usePztPlayerSearch.js -> verifyPztLogin) - zastapila
# martwy Railway (2026-09-27, zgloszenie: blad przy dodawaniu zawodnika).
s, b = call("POST", f"{U}/functions/v1/pzt-player-lookup", {"login": "MRO2043343"})
d = json.loads(b) if s == 200 else {}
check("funkcja pzt-player-lookup znajduje prawdziwego zawodnika", s == 200 and d.get("found") is True, f"HTTP {s} {b[:120]}")
s, b = call("POST", f"{U}/functions/v1/pzt-player-lookup", {"login": "NIEISTNIEJACYLOGIN999"})
d = json.loads(b) if s == 200 else {}
check("funkcja pzt-player-lookup zwraca found=false dla nieistniejacego loginu", s == 200 and d.get("found") is False, f"HTTP {s} {b[:120]}")

# 6. Auth
s, b = call("GET", f"{U}/auth/v1/settings")
d = json.loads(b) if s == 200 else {}
check("auth: e-mail wymagany do potwierdzenia", d.get("mailer_autoconfirm") is False, f"autoconfirm={d.get('mailer_autoconfirm')}")
check("auth: rejestracja przez zewnetrznych dostawcow wylaczona", not any(v for k, v in d.get("external", {}).items() if k not in ("email", "phone")))
s, b = call("POST", f"{U}/auth/v1/token?grant_type=password", {"email": "nieistnieje@example.com", "password": "zle-haslo-123"})
check("auth: bledne logowanie odrzucone", s == 400, f"HTTP {s}")
s, b = call("POST", f"{U}/auth/v1/recover", {"email": "nieistnieje@example.com"})
check("auth: reset hasla nie zdradza czy konto istnieje", s == 200 and b.strip() == "{}", f"HTTP {s} {b[:40]}")

# 7. Strony i pliki
def head(url):
    req = urllib.request.Request(url, method="GET", headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return 0, b""

for p in ["app/", "app/manifest.webmanifest", "app/push-sw.js", "app/sw.js", "app/icon-192.png", "testerzy.html", "admin.html",
          "dokumentacja.html", "potwierdz-email.html", "config.js"]:
    s, b = head(f"{PAGES}/{p}")
    check(f"strona {p} dostepna", s == 200 and len(b) > 50, f"HTTP {s}, {len(b)} B")
s, b = head(f"{PAGES}/app/turnieje")
check("deep link /app/turnieje: strona 404 zawiera przekierowanie do aplikacji", s == 404 and b"l.replace(" in b, f"HTTP {s}")
s, b = head(f"{PAGES}/app/?/turnieje")
check("adres /app/?/turnieje otwiera aplikacje", s == 200 and b'id="root"' in b, f"HTTP {s}")
s, b = head("https://github.com/AkademiaTenisowaZabrze/Tennis-Together/releases/download/debug-latest/tennis-together-debug-latest.apk")
check("APK do pobrania", s == 200 and len(b) > 1_000_000, f"HTTP {s}, {len(b)//1024} KB")
s, b = head("https://pzt-rankingi-api-production.up.railway.app/health")
print("INFO serwis PZT /health:", s)

print()
print(sum(1 for r in results if r[1]), "z", len(results), "testow przeszlo")
for r in results:
    if not r[1]:
        print("NIEPRZESZLY:", r[0], "|", r[2])
