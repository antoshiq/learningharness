// Practice without the tutor, stats, the spending cap and backups, on a throwaway database.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Question } from "@/lib/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-practice-"));
process.env.TUTOR_DATA_DIR = dir;
process.env.TUTOR_SECRETS_FILE = path.join(dir, "secrets.json");
process.env.ANTHROPIC_API_KEY = "test-key-never-sent";
delete process.env.TUTOR_MOCK;

let dbmod: typeof import("@/server/db");
let practice: typeof import("@/server/practice");
let stats: typeof import("@/server/stats");

const DAY = 86_400_000;
const choice: Question = { purpose: "check", kind: "choice", prompt: "Чему равно 2 + 2?", options: ["3", "4"], correct_option: 1, node_key: "sum" };
const free: Question = { purpose: "check", kind: "free", prompt: "Что такое функция?", reference_answer: "Именованный блок кода", node_key: "func" };

beforeAll(async () => {
  dbmod = await import("@/server/db");
  practice = await import("@/server/practice");
  stats = await import("@/server/stats");
});

function seed() {
  const db = dbmod.getDb();
  const { schema } = dbmod;
  const now = Date.now();
  const topic = db.insert(schema.topics).values({ title: "Тест", createdAt: now, updatedAt: now }).returning().get();
  const session = db.insert(schema.sessions).values({ topicId: topic.id, kind: "lesson", messages: [], startedAt: now - 3600_000, endedAt: now }).returning().get();
  for (const [key, title] of [
    ["sum", "Сложение"],
    ["func", "Функции"],
  ]) {
    db.insert(schema.nodes)
      .values({ topicId: topic.id, key, title, deps: [], status: "learning", dueAt: now - 2 * DAY })
      .run();
  }
  const attempt = (q: Question, outcome: "wrong" | "correct") =>
    db
      .insert(schema.attempts)
      .values({
        sessionId: session.id,
        topicId: topic.id,
        nodeKey: q.node_key,
        toolUseId: `t${Math.random()}`,
        purpose: q.purpose,
        kind: q.kind,
        question: q,
        answer: q.kind === "choice" ? { choice: 0 } : { text: "не помню" },
        outcome,
        misconception: outcome === "wrong" ? "перепутал" : null,
        createdAt: now - DAY,
        answeredAt: now - DAY,
      })
      .returning()
      .get();
  return { topic, wrongChoice: attempt(choice, "wrong"), freeOne: attempt(free, "wrong") };
}

describe("practice without the tutor", () => {
  it("queues due ideas with stored questions and grades answers", () => {
    const { topic, wrongChoice, freeOne } = seed();
    const queue = practice.reviewQueue(topic.id);
    expect(queue.items.map((i) => i.attemptId).sort()).toEqual([wrongChoice.id, freeOne.id].sort());
    expect(queue.items[0].overdueDays).toBe(2);

    expect(practice.openMistakes(topic.id)).toHaveLength(2);

    // Checkable kinds are graded on the server from the answer.
    expect(practice.recordDrill({ attemptId: wrongChoice.id, mode: "review", answer: { choice: 1, confidence: 2 } }).outcome).toBe("correct");
    // Free answers need the learner's own grade.
    expect(() => practice.recordDrill({ attemptId: freeOne.id, mode: "review", answer: { text: "блок" } })).toThrow(/Оцени/);
    expect(practice.recordDrill({ attemptId: freeOne.id, mode: "review", answer: { text: "блок" }, selfGrade: "partial" }).outcome).toBe("partial");

    // The solved mistake is gone; the partly solved one stays.
    expect(practice.openMistakes(topic.id).map((m) => m.attemptId)).toEqual([freeOne.id]);
    // Both ideas were rescheduled into the future.
    const nodes = dbmod.getDb().select().from(dbmod.schema.nodes).all().filter((n) => n.topicId === topic.id);
    expect(nodes.every((n) => n.dueAt! > Date.now())).toBe(true);
    expect(practice.reviewQueue(topic.id).items).toHaveLength(0);
  });
});

describe("stats", () => {
  it("counts streaks across days and tolerates an empty today", () => {
    const now = new Date(2026, 10, 17, 15).getTime();
    const k = (daysAgo: number) => stats.dayKey(new Date(2026, 10, 17 - daysAgo, 12).getTime());
    expect(stats.streaks(new Set([k(0), k(1), k(2), k(5)]), now)).toEqual({ current: 3, longest: 3 });
    expect(stats.streaks(new Set([k(1), k(2)]), now).current).toBe(2);
    expect(stats.streaks(new Set([k(3), k(4), k(5), k(6)]), now)).toEqual({ current: 0, longest: 4 });
  });

  it("reports activity, accuracy and spending", () => {
    const s = stats.getStats(null);
    expect(s.totals.drills).toBeGreaterThanOrEqual(2);
    expect(s.days.find((d) => d.date === s.today)?.drills).toBeGreaterThanOrEqual(2);
    expect(s.cost.days).toHaveLength(30);
  });
});

describe("daily spending cap", () => {
  it("stops model calls once today's spending reaches the cap", async () => {
    const { updateConfig, getConfig } = await import("@/server/config");
    const { chatAs } = await import("@/server/llm");
    dbmod
      .getDb()
      .insert(dbmod.schema.usage)
      .values({ sessionId: null, purpose: "test", provider: "anthropic", model: "x", cost: 0.5, createdAt: Date.now() })
      .run();
    updateConfig({ dailyLimit: 0.25 });
    expect(getConfig().dailyLimit).toBe(0.25);
    expect(getConfig().spentToday).toBeCloseTo(0.5);
    await expect(chatAs("strong", "test", null, { system: "", messages: [] })).rejects.toThrow(/лимит/);
    expect(() => updateConfig({ dailyLimit: -1 })).toThrow();
    updateConfig({ dailyLimit: null });
  });
});

describe("backups", () => {
  it("restores a downloaded copy and keeps the replaced data", async () => {
    const backup = await import("@/server/backup");
    const { schema } = dbmod;
    const count = () => dbmod.getDb().select().from(schema.topics).all().length;
    const before = count();
    const { file } = await backup.exportCopy();
    dbmod.getDb().insert(schema.topics).values({ title: "Лишняя", createdAt: 1, updatedAt: 1 }).run();
    expect(count()).toBe(before + 1);

    const r = await backup.restoreFrom(file);
    expect(count()).toBe(before);
    expect(backup.listBackups().map((b) => b.name)).toContain(r.savedAs);

    const junk = path.join(dir, "junk.db");
    fs.writeFileSync(junk, "not a database");
    await expect(backup.restoreFrom(junk)).rejects.toThrow();
    expect(count()).toBe(before);
  });
});
