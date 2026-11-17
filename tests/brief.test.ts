// Quick overviews against the scripted model: topic, files, repository, theses, topic creation.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { StreamEvent } from "@/lib/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-brief-"));
process.env.TUTOR_DATA_DIR = dir;
process.env.TUTOR_SECRETS_FILE = path.join(dir, "secrets.json");
process.env.TUTOR_MOCK = "1";

let brief: typeof import("@/server/brief");
let dbmod: typeof import("@/server/db");

beforeAll(async () => {
  brief = await import("@/server/brief");
  dbmod = await import("@/server/db");
});

async function write(input: Parameters<typeof brief.checkInput>[0]) {
  const events: StreamEvent[] = [];
  const id = await brief.writeBrief(brief.checkInput(input), (e) => events.push(e));
  return { id, events };
}

describe("quick overview", () => {
  it("writes a topic overview, defaulting to five minutes", async () => {
    const { id, events } = await write({ kind: "topic", topic: "Сложение" });
    expect(events).toContainEqual({ type: "saved", id });
    expect(events.some((e) => e.type === "text")).toBe(true);
    const b = brief.getBrief(id)!;
    expect(b.depth).toBe(5);
    expect(b.text).toContain("## Главное");
    expect(brief.listBriefs()[0].id).toBe(id);
  });

  it("opens a thesis once and serves it from the cache after", async () => {
    const { id } = await write({ kind: "topic", topic: "Сложение", depth: 1 });
    const run = async () => {
      const out: string[] = [];
      await brief.expandThesis(id, "**Переместительность** — от перестановки слагаемых сумма не меняется.", (e) => e.type === "text" && out.push(e.delta));
      return out.join("");
    };
    const first = await run();
    expect(first).toContain("Подробнее");
    const usage = () => dbmod.getDb().select().from(dbmod.schema.usage).all().filter((u) => u.purpose === "brief-expand").length;
    const calls = usage();
    expect(await run()).toBe(first);
    expect(usage()).toBe(calls);
    expect(Object.keys(brief.getBrief(id)!.expansions)).toEqual(["Переместительность — от перестановки слагаемых сумма не меняется."]);
  });

  it("reads files from paths and uploads, and refuses secrets and folders", async () => {
    const f = path.join(dir, "calc.py");
    fs.writeFileSync(f, "def add(a, b):\n    return a + b\n");
    const { id } = await write({ kind: "files", paths: [f], uploads: [{ name: "notes.txt", content: "заметки" }] });
    expect(brief.getBrief(id)!.files).toEqual(["calc.py", "notes.txt"]);
    await expect(write({ kind: "files", uploads: [{ name: ".env", content: "KEY=1" }] })).rejects.toThrow(/секрет/);
    await expect(write({ kind: "files", paths: [dir] })).rejects.toThrow(/папка/);
    await expect(write({ kind: "files" })).rejects.toThrow(/хотя бы один/);
  });

  it("reads a repository's key files and turns the overview into a repo topic", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-brief-repo-"));
    fs.writeFileSync(path.join(repo, "README.md"), "# Демо\nПроект для теста.");
    fs.mkdirSync(path.join(repo, "src"));
    fs.writeFileSync(path.join(repo, "src", "main.py"), "print('hi')\n");
    fs.writeFileSync(path.join(repo, ".env"), "SECRET=1");
    const { id, events } = await write({ kind: "repo", repoPath: repo, depth: 15 });
    const b = brief.getBrief(id)!;
    expect(b.files).toContain("README.md");
    expect(b.files).toContain("src/main.py");
    expect(b.files).not.toContain(".env");
    expect(events.some((e) => e.type === "status")).toBe(true);

    const topicId = brief.briefToTopic(id);
    expect(brief.briefToTopic(id)).toBe(topicId);
    const { eq } = await import("drizzle-orm");
    const t = dbmod.getDb().select().from(dbmod.schema.topics).where(eq(dbmod.schema.topics.id, topicId)).get()!;
    expect(t.kind).toBe("repo");
    expect(t.repoMap).toBe(b.text);
    expect(t.brief).toBe(b.text);
  });
});
