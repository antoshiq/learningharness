// Git for the repository features: a GitHub link becomes a local clone in
// data/repos, and "what changed" reads the history since a known commit.
// git runs without a shell and never asks for credentials: public repos only.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { StreamEvent } from "@/lib/types";
import { DATA_DIR } from "./paths";

const GITHUB = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([\w./-]+?))?\/?(?:[?#].*)?$/i;
const SAFE = /^[\w.-]+$/;

export const REPOS_DIR = () => path.join(DATA_DIR, "repos");

function git(args: string[], cwd?: string, timeout = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" } },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message).trim().split("\n").slice(-3).join(" ");
          if ((err as NodeJS.ErrnoException).code === "ENOENT") reject(new Error("Не найден git. Установи Git для Windows: https://git-scm.com"));
          else reject(new Error(msg));
        } else resolve(stdout);
      },
    );
  });
}

export function parseGithub(input: string): { owner: string; repo: string; branch: string | null; url: string } | null {
  const m = GITHUB.exec(input.trim());
  if (!m || !SAFE.test(m[1]) || !SAFE.test(m[2])) return null;
  // A tree/blob link carries a branch and maybe a path; only a simple branch name is used.
  const branch = m[3] && /^[\w.-]+$/.test(m[3].split("/")[0]) ? m[3].split("/")[0] : null;
  return { owner: m[1], repo: m[2], branch, url: `https://github.com/${m[1]}/${m[2]}` };
}

export const isGithubLink = (s: string) => parseGithub(s) !== null;

/**
 * A local folder for `input`: the folder itself, or for a GitHub link a clone
 * that is fetched fresh each time. Returns the commit it was at before updating.
 */
export async function resolveRepo(input: string, emit?: (e: StreamEvent) => void): Promise<{ root: string; url: string | null; before: string | null }> {
  const gh = parseGithub(input);
  if (!gh) {
    const p = path.resolve(input.trim().replace(/^"(.*)"$/, "$1"));
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error("Папка не найдена. Укажи путь к папке проекта или ссылку на GitHub.");
    return { root: fs.realpathSync(p), url: null, before: null };
  }
  const dir = path.join(REPOS_DIR(), `${gh.owner}__${gh.repo}`);
  fs.mkdirSync(REPOS_DIR(), { recursive: true });
  if (fs.existsSync(path.join(dir, ".git"))) {
    const before = await headCommit(dir);
    emit?.({ type: "status", text: "Обновляю репозиторий с GitHub…" });
    try {
      const ref = gh.branch ?? "HEAD";
      await git(["fetch", "--depth=100", "origin", ref], dir, 180_000);
      // Our own clone: nothing local to keep, so follow the remote exactly.
      await git(["reset", "--hard", "FETCH_HEAD"], dir);
    } catch (e) {
      // Offline or rate-limited: the last copy is still useful.
      emit?.({ type: "status", text: `Не удалось обновить (${e instanceof Error ? e.message : e}), использую сохранённую копию…` });
    }
    return { root: dir, url: gh.url, before };
  }
  emit?.({ type: "status", text: `Скачиваю ${gh.owner}/${gh.repo} с GitHub…` });
  const args = ["clone", "--depth=100", "--single-branch", "--no-tags", ...(gh.branch ? ["--branch", gh.branch] : []), `${gh.url}.git`, dir];
  try {
    await git(args, undefined, 300_000);
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    const msg = e instanceof Error ? e.message : String(e);
    if (/not found|could not read Username|Authentication|terminal prompts disabled/i.test(msg)) {
      throw new Error("Репозиторий не найден или закрытый. Работают только публичные репозитории GitHub.");
    }
    throw new Error(`Не удалось скачать репозиторий: ${msg}`);
  }
  return { root: dir, url: gh.url, before: null };
}

export async function isGitRepo(root: string): Promise<boolean> {
  try {
    return (await git(["rev-parse", "--is-inside-work-tree"], root, 15_000)).trim() === "true";
  } catch {
    return false;
  }
}

export async function headCommit(root: string): Promise<string | null> {
  try {
    return (await git(["rev-parse", "HEAD"], root, 15_000)).trim() || null;
  } catch {
    return null;
  }
}

export interface Changes {
  from: string | null;
  to: string;
  commits: number;
  log: string;
  stat: string;
  diff: string;
  /** Uncommitted changes in a local folder are included too. */
  dirty: boolean;
}

/**
 * History since `since` (or the last two weeks, at most 30 commits, when there
 * is no starting point). Lock files and generated files are left out of the diff.
 */
export async function changesSince(root: string, since: string | null, budget: number): Promise<Changes> {
  if (!(await isGitRepo(root))) throw new Error("Эта папка не git-репозиторий: изменения смотреть не по чему.");
  const to = (await headCommit(root)) ?? "HEAD";
  let from = since;
  if (from) {
    try {
      await git(["cat-file", "-e", `${from}^{commit}`], root, 15_000);
    } catch {
      from = null; // the old commit is gone (history rewritten, shallow clone)
    }
  }
  const range = from ? [`${from}..HEAD`] : ["--since=14.days", "-n", "30"];
  const log = (await git(["log", "--date=short", "--format=%h %ad %an: %s", ...range], root)).trim();
  const commits = log ? log.split("\n").length : 0;
  if (!from && commits) {
    const oldest = log.split("\n").at(-1)!.split(" ")[0];
    try {
      from = (await git(["rev-parse", `${oldest}^`], root, 15_000)).trim();
    } catch {
      from = null; // the first commit of a shallow history
    }
  }
  const exclude = [":(exclude)package-lock.json", ":(exclude)yarn.lock", ":(exclude)pnpm-lock.yaml", ":(exclude)*.min.*", ":(exclude)*.snap", ":(exclude)*.svg", ":(exclude)*.map"];
  const base = from ?? (commits ? `${log.split("\n").at(-1)!.split(" ")[0]}` : "HEAD");
  const status = (await git(["status", "--porcelain"], root, 30_000)).trim();
  const target = status ? [base] : [base, "HEAD"];
  const stat = (await git(["diff", "--stat=120", ...target, "--", ".", ...exclude], root)).trim();
  let diff = (await git(["diff", "--unified=2", "--no-color", ...target, "--", ".", ...exclude], root)).trim();
  if (diff.length > budget) diff = diff.slice(0, budget) + `\n… (изменения обрезаны, всего ${diff.length} символов)`;
  return { from, to, commits, log, stat, diff, dirty: !!status };
}
