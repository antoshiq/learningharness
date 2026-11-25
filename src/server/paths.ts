import path from "node:path";
import os from "node:os";

export const ROOT = process.cwd();
/** Learning data: SQLite database. Inside the project folder, ignored by git. */
export const DATA_DIR = process.env.TUTOR_DATA_DIR ?? path.join(ROOT, "data");
/** API keys live outside the project so they can never be committed with it. */
export const SECRETS_FILE = process.env.TUTOR_SECRETS_FILE ?? path.join(os.homedir(), ".tutor", "secrets.json");

/** Resolve a local path typed by the user, stripping quotes and expanding leading ~. */
export function expandUserPath(input: string): string {
  const stripped = input.trim().replace(/^(['"])(.*)\1$/, "$2");
  if (stripped === "~") return os.homedir();
  if (stripped.startsWith("~/") || stripped.startsWith("~\\")) return path.join(os.homedir(), stripped.slice(2));
  return path.resolve(stripped);
}
