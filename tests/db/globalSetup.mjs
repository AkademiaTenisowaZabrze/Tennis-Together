// Buduje JEDEN raz szablon bazy (wszystkie migracje na PGlite) i zapisuje go
// na dysku. Każdy plik testowy ładuje potem kopię szablonu (kilkaset ms),
// zamiast uruchamiać 42 migracje od nowa.
import { PGlite } from "@electric-sql/pglite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..");
// TT_MIGRATIONS_DIR pozwala przetestować inny zestaw migracji (np. nową migrację 0043 przed
// wdrożeniem albo "zepsuty" zestaw w testach mutacyjnych) bez ruszania prawdziwych plików.
export const MIGRATIONS_DIR = process.env.TT_MIGRATIONS_DIR
  ? path.resolve(process.env.TT_MIGRATIONS_DIR)
  : path.join(ROOT, "supabase", "migrations");
export const CACHE_DIR = path.join(ROOT, "tests", ".cache");

export function readMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf-8") }));
}

// Rozszerzeń, których PGlite nie ma, a które nie wpływają na logikę testów.
export function adaptForLocal(sql) {
  return sql
    .replace(/create extension if not exists postgis;?/gi, "")
    .replace(/create extension if not exists pg_net;?/gi, "");
}

function currentHash() {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(path.join(here, "shim.sql")));
  for (const m of readMigrations()) h.update(m.file + m.sql);
  return h.digest("hex");
}

// Nazwa szablonu zależy od zawartości migracji, więc różne zestawy nie nadpisują się nawzajem.
export const TEMPLATE_FILE = path.join(CACHE_DIR, `template-${currentHash().slice(0, 16)}.tar.gz`);

export default async function setup() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (fs.existsSync(TEMPLATE_FILE)) return;
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(here, "shim.sql"), "utf-8"));
  for (const m of readMigrations()) {
    try {
      await db.exec(adaptForLocal(m.sql));
    } catch (e) {
      throw new Error(`Migracja ${m.file} nie przeszła w lokalnym Postgresie: ${e.message}`);
    }
  }
  const dump = await db.dumpDataDir("gzip");
  fs.writeFileSync(TEMPLATE_FILE, Buffer.from(await dump.arrayBuffer()));
  await db.close();
}
