// Copies the Python runtime (Pyodide) from node_modules into public/pyodide so
// the app serves it itself: no CDN needed, and it works on a phone over Wi-Fi.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "pyodide");
const dst = path.join(root, "public", "pyodide");
// source name -> served name. The standard library is a .zip, and download
// managers (IDM and the like) hijack browser requests for archive extensions,
// so it is served under a neutral one.
const FILES = {
  "pyodide.mjs": "pyodide.mjs",
  "pyodide.asm.mjs": "pyodide.asm.mjs",
  "pyodide.asm.wasm": "pyodide.asm.wasm",
  "pyodide-lock.json": "pyodide-lock.json",
  "python_stdlib.zip": "python_stdlib.data",
};

export function copyPyodide() {
  const version = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8")).version;
  const marker = path.join(dst, "version.json");
  try {
    if (JSON.parse(fs.readFileSync(marker, "utf8")).version === version && Object.values(FILES).every((f) => fs.existsSync(path.join(dst, f)))) {
      return version;
    }
  } catch {}
  fs.mkdirSync(dst, { recursive: true });
  for (const [from, to] of Object.entries(FILES)) fs.copyFileSync(path.join(src, from), path.join(dst, to));
  fs.writeFileSync(marker, JSON.stringify({ version }));
  console.log(`Среда Python (Pyodide ${version}) скопирована в public/pyodide`);
  return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) copyPyodide();
