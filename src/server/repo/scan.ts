// Read-only access to a learner's repository. Everything the agent can see
// comes from one scan: files outside it (dependencies, build output, secrets,
// binaries, anything outside the root) are unreachable by construction.
import fs from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";

const SKIP_DIRS = new Set([
  ".git", "node_modules", ".next", "dist", "build", "out", "target", ".venv", "venv", "env", "__pycache__",
  ".idea", ".vscode", "coverage", ".cache", "vendor", ".gradle", "obj", ".node", ".turbo", ".pytest_cache",
  ".mypy_cache", ".tox", "bower_components", ".svn", ".hg", ".terraform",
]);

const SECRET_PATTERNS = [
  /^\.env(\..*)?$/i, /\.pem$/i, /\.key$/i, /\.pfx$/i, /\.p12$/i, /\.keystore$/i, /\.jks$/i, /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /^secrets?\./i, /^credentials/i, /^\.npmrc$/i, /^\.netrc$/i, /^\.pypirc$/i, /^auth\.json$/i, /\.kdbx$/i,
  /^\.htpasswd$/i, /service[-_]?account.*\.json$/i,
];

const SKIP_FILES = [
  /^package-lock\.json$/, /^yarn\.lock$/, /^pnpm-lock\.yaml$/, /\.lock$/, /\.min\.(js|css)$/, /\.map$/, /^\.DS_Store$/,
];

const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "icns", "bmp", "tiff", "svgz", "pdf", "zip", "gz", "tar", "7z", "rar",
  "exe", "dll", "so", "dylib", "bin", "class", "jar", "wasm", "pyc", "o", "a", "lib", "woff", "woff2", "ttf", "otf",
  "eot", "mp3", "mp4", "mov", "avi", "wav", "ogg", "webm", "db", "sqlite", "sqlite3", "pack", "idx", "riv", "psd",
]);

export const MAX_FILE_BYTES = 300_000;
const MAX_FILES = 6000;

export interface RepoFile {
  /** POSIX-style path relative to the root */
  path: string;
  bytes: number;
}

export interface ScanResult {
  root: string;
  files: RepoFile[];
  totalBytes: number;
  /** Rough token count if every included file were read once. */
  estTokens: number;
  byExt: { ext: string; files: number; bytes: number }[];
  skippedSecrets: number;
  skippedLarge: number;
  truncated: boolean;
}

export function isSecretName(name: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(name));
}

export function scanRepo(rootInput: string): ScanResult {
  const root = fs.realpathSync(path.resolve(rootInput));
  if (!fs.statSync(root).isDirectory()) throw new Error("Это не папка");

  const files: RepoFile[] = [];
  let skippedSecrets = 0;
  let skippedLarge = 0;
  let truncated = false;

  // Each .gitignore applies to paths relative to the directory it lives in.
  type Scope = { base: string; ig: Ignore };
  const walk = (dirRel: string, scopes: Scope[]) => {
    if (truncated) return;
    const abs = path.join(root, dirRel);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    const gi = entries.find((e) => e.isFile() && e.name === ".gitignore");
    if (gi) {
      try {
        scopes = [...scopes, { base: dirRel, ig: ignore().add(fs.readFileSync(path.join(abs, ".gitignore"), "utf8")) }];
      } catch {}
    }
    const ignored = (rel: string, isDir: boolean) =>
      scopes.some((s) => {
        const sub = s.base ? rel.slice(s.base.length + 1) : rel;
        return sub !== "" && s.ig.ignores(isDir ? sub + "/" : sub);
      });

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
      // Symlinks are never followed: they could point outside the root.
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || ignored(rel, true)) continue;
        walk(rel, scopes);
      } else if (e.isFile()) {
        if (isSecretName(e.name)) {
          skippedSecrets++;
          continue;
        }
        const ext = e.name.includes(".") ? e.name.split(".").pop()!.toLowerCase() : "";
        if (BINARY_EXT.has(ext) || SKIP_FILES.some((re) => re.test(e.name)) || ignored(rel, false)) continue;
        let size = 0;
        try {
          size = fs.statSync(path.join(root, rel)).size;
        } catch {
          continue;
        }
        if (size > MAX_FILE_BYTES) {
          skippedLarge++;
          continue;
        }
        if (files.length >= MAX_FILES) {
          truncated = true;
          return;
        }
        files.push({ path: rel, bytes: size });
      }
    }
  };
  walk("", []);

  const ext = new Map<string, { files: number; bytes: number }>();
  let totalBytes = 0;
  for (const f of files) {
    totalBytes += f.bytes;
    const name = f.path.split("/").pop()!;
    const e = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "(без расширения)";
    const cur = ext.get(e) ?? { files: 0, bytes: 0 };
    cur.files++;
    cur.bytes += f.bytes;
    ext.set(e, cur);
  }
  return {
    root,
    files,
    totalBytes,
    estTokens: Math.round(totalBytes / 3.5),
    byExt: [...ext.entries()].map(([e, v]) => ({ ext: e, ...v })).sort((a, b) => b.bytes - a.bytes),
    skippedSecrets,
    skippedLarge,
    truncated,
  };
}

const cache = new Map<string, { at: number; scan: ScanResult; set: Set<string> }>();

/** Cached scan (30 s) so every tool call doesn't re-walk the tree. */
export function getScan(root: string): { scan: ScanResult; set: Set<string> } {
  const hit = cache.get(root);
  if (hit && Date.now() - hit.at < 30_000) return hit;
  const scan = scanRepo(root);
  const entry = { at: Date.now(), scan, set: new Set(scan.files.map((f) => f.path)) };
  cache.set(root, entry);
  return entry;
}

export function normalizeRel(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) throw new Error("Путь выходит за пределы репозитория");
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

/** Compact directory tree for the agent's first look at the project. */
export function renderTree(scan: ScanResult, maxLines = 220): string {
  const dirs = new Map<string, { files: string[]; sub: Set<string> }>();
  const ensure = (d: string) => {
    if (!dirs.has(d)) dirs.set(d, { files: [], sub: new Set() });
    return dirs.get(d)!;
  };
  ensure("");
  for (const f of scan.files) {
    const parts = f.path.split("/");
    const name = parts.pop()!;
    let cur = "";
    for (const p of parts) {
      const next = cur ? `${cur}/${p}` : p;
      ensure(cur).sub.add(next);
      ensure(next);
      cur = next;
    }
    ensure(cur).files.push(name);
  }
  const count = (d: string): number => {
    const n = dirs.get(d)!;
    return n.files.length + [...n.sub].reduce((s, x) => s + count(x), 0);
  };
  const lines: string[] = [];
  const render = (d: string, depth: number) => {
    const n = dirs.get(d)!;
    const pad = "  ".repeat(depth);
    for (const s of [...n.sub].sort()) {
      if (lines.length >= maxLines) return;
      lines.push(`${pad}${s.split("/").pop()}/ (${count(s)})`);
      if (depth < 2) render(s, depth + 1);
    }
    const shown = depth === 0 ? n.files : n.files.slice(0, 12);
    for (const f of shown) {
      if (lines.length >= maxLines) return;
      lines.push(`${pad}${f}`);
    }
    if (shown.length < n.files.length) lines.push(`${pad}… ещё ${n.files.length - shown.length} файлов`);
  };
  render("", 0);
  if (lines.length >= maxLines) lines.push("… (дерево обрезано, используй list_dir)");
  return lines.join("\n");
}
