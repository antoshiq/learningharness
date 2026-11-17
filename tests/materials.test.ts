// Files attached to a topic: stored as text, shown to the tutor in every lesson.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-materials-"));
process.env.TUTOR_DATA_DIR = dir;
process.env.TUTOR_SECRETS_FILE = path.join(dir, "secrets.json");
process.env.TUTOR_MOCK = "1";

let m: typeof import("@/server/materials");
let dbmod: typeof import("@/server/db");

beforeAll(async () => {
  m = await import("@/server/materials");
  dbmod = await import("@/server/db");
});

describe("topic materials", () => {
  it("stores files, feeds them to the lesson and the cheat sheet, and deletes them", async () => {
    const db = dbmod.getDb();
    const now = Date.now();
    const t = db.insert(dbmod.schema.topics).values({ title: "Матанализ", createdAt: now, updatedAt: now }).returning().get();
    const files = await m.addMaterials(t.id, [
      { name: "лекция 1.md", content: "# Пределы\nПредел последовательности — число, к которому она стремится.\r\n" },
      { name: "base64.txt", content: Buffer.from("Производная — скорость изменения.").toString("base64"), base64: true },
    ]);
    expect(files.map((f) => f.name)).toEqual(["лекция 1.md", "base64.txt"]);

    const text = m.materialsText(t.id);
    expect(text).toContain('<материал файл="лекция 1.md">');
    expect(text).toContain("Производная — скорость изменения.");
    expect(text).not.toContain("\r");

    const { createSession } = await import("@/server/sessions");
    const { initialState } = await import("@/server/agent/state");
    const state = initialState(db, createSession({ topicId: t.id, kind: "lesson" }));
    expect(state).toContain("Материалы, которые приложил ученик");
    expect(state).toContain("Предел последовательности");

    const { notesContext } = await import("@/server/notes");
    expect(notesContext(t.id)).toContain("Предел последовательности");

    m.deleteMaterial(t.id, files[0].id);
    expect(m.listMaterials(t.id).map((f) => f.name)).toEqual(["base64.txt"]);
  });

  it("writes a topic overview from attached files and hands them on to the topic", async () => {
    const brief = await import("@/server/brief");
    const id = await brief.writeBrief(
      brief.checkInput({ kind: "topic", uploads: [{ name: "Ряды.md", content: "Ряд сходится, если частичные суммы имеют предел." }] }),
      () => {},
    );
    const b = brief.getBrief(id)!;
    expect(b.title).toBe("Ряды");
    expect(b.materials).toEqual([{ name: "Ряды.md", content: "Ряд сходится, если частичные суммы имеют предел." }]);
    const { briefSystem } = await import("@/server/brief-prompts");
    expect(briefSystem("topic", 5, false, true)).toContain("Строй экскурс по ним");

    const topicId = brief.briefToTopic(id);
    expect(m.listMaterials(topicId).map((f) => f.name)).toEqual(["Ряды.md"]);
    // A plain topic without files still needs a name.
    await expect(brief.writeBrief(brief.checkInput({ kind: "topic" }), () => {})).rejects.toThrow(/тему или приложи/);
  });

  it("refuses secrets and binaries, and cuts what does not fit the lesson", async () => {
    await expect(m.uploadText({ name: ".env", content: "KEY=1" })).rejects.toThrow(/секрет/);
    await expect(m.uploadText({ name: "img.png", content: Buffer.from([0x89, 0x50, 0, 0, 1]).toString("base64"), base64: true })).rejects.toThrow(/не текстовый/);
    const db = dbmod.getDb();
    const t = db.insert(dbmod.schema.topics).values({ title: "Большая", createdAt: 1, updatedAt: 1 }).returning().get();
    await m.addMaterials(t.id, [
      { name: "a.txt", content: "а".repeat(1000) },
      { name: "b.txt", content: "б".repeat(1000) },
    ]);
    const cut = m.materialsText(t.id, 1600); // a fits whole, b is cut to the 600 left
    expect(cut).toContain("файл обрезан");
    expect(m.materialsText(t.id, 600)).toContain("Не поместились в контекст: b.txt");
  });
});
