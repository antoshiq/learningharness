// The oral exam against the scripted examiner.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-oral-"));
process.env.TUTOR_DATA_DIR = dir;
process.env.TUTOR_SECRETS_FILE = path.join(dir, "secrets.json");
process.env.TUTOR_MOCK = "1";

let sem: typeof import("@/server/semester");
let oral: typeof import("@/server/oral");
let jobs: typeof import("@/server/jobs");

beforeAll(async () => {
  sem = await import("@/server/semester");
  oral = await import("@/server/oral");
  jobs = await import("@/server/jobs");
});

async function moduleTopic() {
  const id = sem.createSemester({ request: "Пределы", level: "standard", weeks: 4, hoursPerWeek: 4 });
  sem.startPreparation(id);
  await jobs.waitJob(`semester:${id}`);
  sem.approveProgram(id);
  await jobs.waitJob(`semester-modules:${id}`);
  return { id, topicId: sem.getSemesterView(id).modules[1].topicId! };
}

describe("oral exam", () => {
  it("asks, follows up, ends, grades by idea and counts explained ideas", async () => {
    const { id, topicId } = await moduleTopic();
    const before = sem.getSemesterView(id).modules[1].ideas!.explained;
    let o = await oral.startOral(topicId);
    expect(o.status).toBe("active");
    expect(o.turns).toHaveLength(1);
    expect(o.turns[0]).toMatchObject({ role: "examiner", text: "(тест) Вопрос 1: объясни своими словами." });

    await expect(oral.answerOral(o.id, "  ")).rejects.toThrow(/пустой/);
    o = await oral.answerOral(o.id, "Предел — это число, к которому стремится последовательность.");
    expect(o.turns.map((t) => t.role)).toEqual(["examiner", "student", "examiner"]);
    o = await oral.answerOral(o.id, "Для любого эпсилон найдётся номер.");
    expect(o.status).toBe("done");
    expect(o.result).toMatchObject({ score: 80, feedback: "(тест) Хорошо." });
    expect(o.result!.ideas[0]).toMatchObject({ verdict: "correct" });
    await expect(oral.answerOral(o.id, "ещё")).rejects.toThrow(/закончен/);

    const v = sem.getSemesterView(id);
    expect(v.modules[1].ideas!.explained).toBe(before + 1);
    expect(v.active!.grades.find((g) => g.kind === "oral")).toMatchObject({ score: 80 });
    // The oral exam is in the grade book, not in the grade.
    expect(v.active!.grade).toBeNull();
    expect(oral.listOral(topicId)[0]).toMatchObject({ id: o.id, status: "done", score: 80 });
  });

  it("can be ended early; with no answers it is not graded", async () => {
    const { id, topicId } = await moduleTopic();
    const o = await oral.finishOral((await oral.startOral(topicId)).id);
    expect(o.result).toMatchObject({ score: 0, ideas: [] });
    expect(sem.getSemesterView(id).active!.grades.some((g) => g.kind === "oral")).toBe(false);
  });

  it("needs a plan", async () => {
    const { getDb, schema } = await import("@/server/db");
    const t = getDb().insert(schema.topics).values({ title: "Пусто", createdAt: Date.now(), updatedAt: Date.now() }).returning().get();
    await expect(oral.startOral(t.id)).rejects.toThrow(/нет плана/);
  });
});
