// Launcher: node scripts/run.mjs <dev|start> [--lan] [--port N] [--rebuild]
//   dev    - development server with hot reload
//   start  - production server (builds first when sources changed)
//   --lan  - listen on the local network so a phone can connect; password required
import { spawn, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const args = process.argv.slice(2);
const mode = args[0] === "dev" ? "dev" : "start";
const lan = args.includes("--lan");
const port = args.includes("--port") ? args[args.indexOf("--port") + 1] : "3000";
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

if (!fs.existsSync(nextBin)) {
  console.error("Зависимости не установлены. Запусти install.cmd.");
  process.exit(1);
}

const { copyPyodide } = await import("./copy-pyodide.mjs");
copyPyodide();

// Child processes must find this same Node first on PATH.
const env = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH };

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

if (lan) {
  const file = path.join(root, "data", "lan-password.txt");
  let password = "";
  try {
    password = fs.readFileSync(file, "utf8").trim();
  } catch {}
  if (!password) {
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    password = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join("");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, password + "\n");
  }
  env.TUTOR_LAN_PASSWORD = password;
  env.TUTOR_ALLOWED_ORIGINS = lanAddresses().join(",");
}

function newestMtime(dir) {
  let newest = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    newest = Math.max(newest, e.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return newest;
}

if (mode === "start") {
  const buildId = path.join(root, ".next", "BUILD_ID");
  const built = fs.existsSync(buildId) ? fs.statSync(buildId).mtimeMs : 0;
  const sources = Math.max(
    newestMtime(path.join(root, "src")),
    newestMtime(path.join(root, "public")),
    fs.statSync(path.join(root, "package.json")).mtimeMs,
    fs.statSync(path.join(root, "next.config.ts")).mtimeMs,
  );
  if (args.includes("--rebuild") || sources > built) {
    console.log("Собираю приложение (около минуты)…");
    const r = spawnSync(process.execPath, [nextBin, "build"], { stdio: "inherit", env });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

console.log("");
console.log(`  На этом компьютере:  http://localhost:${port}`);
if (lan) {
  for (const ip of lanAddresses()) console.log(`  С телефона (та же сеть Wi-Fi):  http://${ip}:${port}`);
  console.log(`  Пароль для входа:  ${env.TUTOR_LAN_PASSWORD}`);
  console.log("  Если Windows спросит про брандмауэр — разреши доступ для частных сетей.");
}
console.log("  Остановить: Ctrl+C");
console.log("");

const child = spawn(process.execPath, [nextBin, mode, "-H", lan ? "0.0.0.0" : "127.0.0.1", "-p", port], {
  stdio: "inherit",
  env,
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
