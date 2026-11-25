// Copies the PostgreSQL WebAssembly runtime (PGlite) from node_modules into
// public/pglite so the app serves it locally: no CDN needed, works offline and
// on a phone over Wi-Fi.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "@electric-sql", "pglite");
const dist = path.join(src, "dist");
const dst = path.join(root, "public", "pglite");

const KEEP = (name) => /\.(js|wasm|data)$/.test(name) && !name.endsWith(".map");

export function copyPglite() {
  if (!fs.existsSync(path.join(src, "package.json"))) return null;
  const version = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8")).version;
  const files = fs.readdirSync(dist).filter(KEEP);
  const marker = path.join(dst, "version.json");
  try {
    if (
      JSON.parse(fs.readFileSync(marker, "utf8")).version === version &&
      files.every((f) => fs.existsSync(path.join(dst, f)))
    ) {
      return version;
    }
  } catch {}
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(dist, f), path.join(dst, f));
  fs.writeFileSync(marker, JSON.stringify({ version }));
  console.log(`Среда PostgreSQL (PGlite ${version}) скопирована в public/pglite`);
  return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) copyPglite();
