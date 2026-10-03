// Pomocnik testów statycznych: odczyt plików repozytorium i listy śledzonej przez git.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf-8");
export const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// Pliki śledzone przez git (bez zależności i wygenerowanych katalogów).
export function trackedFiles() {
  const out = execSync("git ls-files", { cwd: ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  return out
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => !f.startsWith("node_modules/") && !f.startsWith("dist/"));
}

const BINARY = /\.(png|jpe?g|gif|webp|ico|keystore|jar|apk|aab|docx|pdf|woff2?|ttf|zip|gz|so)$/i;

export function trackedTextFiles() {
  return trackedFiles().filter((f) => !BINARY.test(f) && f !== "package-lock.json" && !f.startsWith("tests/"));
}

export function filesUnder(rel, extRe) {
  const base = path.join(ROOT, rel);
  const out = [];
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (!extRe || extRe.test(e.name)) out.push(path.relative(ROOT, p).replace(/\\/g, "/"));
    }
  })(base);
  return out;
}

export const lineOf = (text, index) => text.slice(0, index).split("\n").length;
