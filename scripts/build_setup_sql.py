"""Skleja wszystkie migracje w jeden plik SQL do wklejenia w NOWYM projekcie
Supabase (SQL Editor) — potrzebne tylko, jeśli zakładasz nowy projekt zamiast
przenosić istniejący między organizacjami.

Użycie:
  python scripts/build_setup_sql.py --url https://XXXX.supabase.co --key sb_publishable_...

Podmienia adres projektu i klucz publishable zaszyte w 0020_push_notifications.sql
(trigger powiadomień woła Edge Function nowego projektu). Wynik:
supabase/setup/full_setup.sql (w .gitignore).
"""
import argparse
import pathlib

OLD_URL = "https://jrabxtiranllayerhutm.supabase.co"
OLD_KEY = "sb_publishable_8-yxyMhoEEq-kHx2opU0Pg_QylogBur"

ap = argparse.ArgumentParser()
ap.add_argument("--url", required=True)
ap.add_argument("--key", required=True)
args = ap.parse_args()

root = pathlib.Path(__file__).resolve().parent.parent
parts = []
for f in sorted((root / "supabase" / "migrations").glob("*.sql")):
    sql = f.read_text(encoding="utf-8").replace(OLD_URL, args.url.rstrip("/")).replace(OLD_KEY, args.key)
    parts.append(f"-- ===== {f.name} =====\n{sql}\n")

out = root / "supabase" / "setup" / "full_setup.sql"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text("\n".join(parts), encoding="utf-8")
print(f"Zapisano {out} ({len(parts)} migracji)")
