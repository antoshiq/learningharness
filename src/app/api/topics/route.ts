import fs from "node:fs";
import path from "node:path";
import { getConfig, roleProblem } from "@/server/config";
import { getDb, schema } from "@/server/db";
import { handle, json } from "@/server/http";
import { listTopics } from "@/server/sessions";

export const GET = () =>
  handle(() => {
    const cfg = getConfig();
    return json({ topics: listTopics(), modelProblem: roleProblem(cfg.roles.strong) });
  });

export const POST = (req: Request) =>
  handle(async () => {
    const body = (await req.json()) as { title?: string; goal?: string; kind?: string; repoPath?: string };
    const kind = body.kind === "repo" ? "repo" : "topic";
    let title = (body.title ?? "").trim();
    let repoPath: string | null = null;
    if (kind === "repo") {
      const p = path.resolve((body.repoPath ?? "").trim());
      if (!body.repoPath?.trim() || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
        throw new Error("Папка репозитория не найдена");
      }
      repoPath = fs.realpathSync(p);
      if (!title) title = path.basename(repoPath);
    }
    if (!title) throw new Error("Укажи, что ты хочешь изучить");
    const now = Date.now();
    const row = getDb()
      .insert(schema.topics)
      .values({
        title: title.slice(0, 200),
        goal: (body.goal ?? "").trim().slice(0, 1000),
        kind,
        repoPath,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.topics.id })
      .get();
    return json({ id: row.id });
  });
