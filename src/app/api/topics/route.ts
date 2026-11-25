import path from "node:path";
import { getConfig, roleProblem } from "@/server/config";
import { getDb, schema } from "@/server/db";
import { parseGithub, resolveRepo } from "@/server/git";
import { uploadText, type Upload } from "@/server/materials";
import { handle, json, sse } from "@/server/http";
import { listTopics } from "@/server/sessions";

export const GET = () =>
  handle(() => {
    const cfg = getConfig();
    return json({ topics: listTopics(), modelProblem: roleProblem(cfg.roles.strong) });
  });

export const POST = (req: Request) =>
  handle(async () => {
    const body = (await req.json()) as {
      title?: string;
      goal?: string;
      kind?: string;
      repoPath?: string;
      uploads?: Upload[];
      skipVision?: boolean;
      stream?: boolean;
    };
    const uploads = Array.isArray(body.uploads) ? body.uploads : [];

    const runCreate = async (onProgress?: (text: string) => void): Promise<number> => {
      // Read the files first: a bad file must not leave an empty topic behind.
      const files = [];
      for (let i = 0; i < uploads.length; i++) {
        const u = uploads[i];
        const prefix = uploads.length > 1 ? `[${i + 1}/${uploads.length}] ${u.name}: ` : `${u.name}: `;
        onProgress?.(`${prefix}обрабатываю…`);
        files.push(await uploadText(u, { skipVision: !!body.skipVision, onProgress: (msg) => onProgress?.(`${prefix}${msg}`) }));
      }
      const kind = body.kind === "repo" ? "repo" : "topic";
      let title = (body.title ?? "").trim();
      let repoPath: string | null = null;
      if (kind === "repo") {
        if (!body.repoPath?.trim()) throw new Error("Укажи папку репозитория или ссылку на GitHub");
        // A GitHub link is cloned into data/repos; a folder is used where it is.
        const repo = await resolveRepo(body.repoPath, onProgress ? (e) => e.type === "status" && onProgress(e.text) : undefined);
        repoPath = repo.root;
        const gh = repo.url ? parseGithub(repo.url) : null;
        if (!title) title = gh ? `${gh.owner}/${gh.repo}` : path.basename(repoPath);
      }
      if (!title && files.length) title = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, "") : `${files[0].name.replace(/\.[^.]+$/, "")} и ещё ${files.length - 1}`;
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
      if (files.length) {
        getDb()
          .insert(schema.topicFiles)
          .values(files.map((f) => ({ topicId: row.id, name: f.name, content: f.content.replace(/\r\n?/g, "\n"), createdAt: now })))
          .run();
      }
      return row.id;
    };

    if (body.stream) {
      return sse(async (emit) => {
        const id = await runCreate((text) => emit({ type: "status", text }));
        emit({ type: "saved", id });
      });
    }
    return json({ id: await runCreate() });
  });
