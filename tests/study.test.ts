// Explaining in one's own words, the plan to a date, subtitles, code review overviews.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-study-"));
process.env.TUTOR_DATA_DIR = dir;
process.env.TUTOR_SECRETS_FILE = path.join(dir, "secrets.json");
process.env.TUTOR_MOCK = "1";

let dbmod: typeof import("@/server/db");
const DAY = 86_400_000;

beforeAll(async () => {
  dbmod = await import("@/server/db");
});

function topicWithPlan(title: string, keys: [string, "new" | "learning" | "mastered"][]) {
  const db = dbmod.getDb();
  const now = Date.now();
  const t = db.insert(dbmod.schema.topics).values({ title, createdAt: now, updatedAt: now }).returning().get();
  keys.forEach(([key, status], i) => db.insert(dbmod.schema.nodes).values({ topicId: t.id, key, title: `Идея ${key}`, deps: [], status, orderIdx: i }).run());
  return t.id;
}

describe("explain in your own words", () => {
  it("reviews an explanation, asks a follow-up and stops when understood", async () => {
    const { reviewExplanation, listExplanations } = await import("@/server/explain");
    const topicId = topicWithPlan("Сложение", [["sum", "learning"]]);
    await expect(reviewExplanation({ topicId, nodeKey: "sum", text: "коротко" })).rejects.toThrow(/короткое/);

    const first = await reviewExplanation({ topicId, nodeKey: "sum", text: "Сложение объединяет два числа в одно, их сумму." });
    expect(first.concept).toBe("Идея sum");
    expect(first.rounds[0].review.verdict).toBe("partial");
    expect(first.rounds[0].review.followup).toContain("ноль");

    const second = await reviewExplanation({ id: first.id, text: "Если прибавить ноль, число не изменится." });
    expect(second.rounds).toHaveLength(2);
    expect(second.rounds[1].review.verdict).toBe("correct");
    expect(listExplanations(topicId)).toHaveLength(1);

    // The first, unaided explanation moved the idea's review date.
    const node = dbmod.getDb().select().from(dbmod.schema.nodes).all().find((n) => n.topicId === topicId)!;
    expect(node.dueAt).not.toBeNull();
  });
});

describe("plan to a date", () => {
  it("spreads the remaining ideas over the days and re-plans from what is left", async () => {
    const plan = await import("@/server/studyplan");
    const a = topicWithPlan("Пределы", [
      ["a1", "mastered"],
      ["a2", "new"],
      ["a3", "new"],
      ["a4", "learning"],
    ]);
    const b = topicWithPlan("Ряды", [
      ["b1", "new"],
      ["b2", "new"],
    ]);
    const empty = topicWithPlan("Новая", []);
    const date = new Date(Date.now() + 10 * DAY);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    expect(() => plan.createPlan({ examDate: iso, topicIds: [] })).toThrow(/хотя бы одну/);
    expect(() => plan.createPlan({ examDate: "2000-01-01", topicIds: [a] })).toThrow(/прошла/);

    const id = plan.createPlan({ title: "Сессия", examDate: iso, topicIds: [a, b, empty] });
    const v = plan.getPlan(id)!;
    expect(v.daysLeft).toBe(10);
    expect(v.progress).toEqual({ mastered: 1, total: 6 });
    // 5 ideas + 1 topic to start over 8 learning days (2 kept for the final review).
    expect(v.perDay).toBe(1);
    expect(v.pace).toBe("ok");
    const learnTasks = v.days.flatMap((d) => d.tasks).filter((t) => t.kind === "learn" || t.kind === "start");
    expect(learnTasks).toHaveLength(6);
    expect(learnTasks[0].kind).toBe("start");
    // Topics are interleaved, and the plan order inside each topic is kept.
    expect(learnTasks.slice(1).map((t) => t.nodeKey)).toEqual(["a2", "b1", "a3", "b2", "a4"]);
    expect(v.days.every((d) => d.tasks.some((t) => t.kind === "review"))).toBe(true);
    expect(v.days.flatMap((d) => d.tasks).some((t) => t.kind === "exam")).toBe(true);
    expect(v.days[0].tasks.every((t) => typeof t.done === "boolean")).toBe(true);

    // Two days left with the same work: the pace goes up and the plan says so.
    const soon = new Date(Date.now() + 2 * DAY);
    plan.updatePlan(id, { title: "Сессия", examDate: `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`, topicIds: [a, b, empty] });
    const tight = plan.getPlan(id)!;
    expect(tight.perDay).toBe(3);
    expect(tight.pace).toBe("tight");
    plan.deletePlan(id);
    expect(plan.getPlan(id)).toBeNull();
  });
});

describe("video and code", () => {
  it("reads YouTube links and subtitle files", async () => {
    const { youtubeId, subtitlesToText } = await import("@/server/youtube");
    expect(youtubeId("https://www.youtube.com/watch?v=aircAruvnKk&t=10")).toBe("aircAruvnKk");
    expect(youtubeId("https://youtu.be/aircAruvnKk")).toBe("aircAruvnKk");
    expect(youtubeId("https://youtube.com/shorts/aircAruvnKk")).toBe("aircAruvnKk");
    expect(youtubeId("https://vimeo.com/123")).toBeNull();
    const srt = "1\n00:00:01,000 --> 00:00:03,000\nПривет\n\n2\n00:00:03,000 --> 00:00:05,000\nПривет\n\n3\n00:01:05,500 --> 00:01:07,000\n<i>Предел</i> последовательности\n";
    expect(subtitlesToText(srt)).toBe("[0:01|1] Привет Предел последовательности");
    const vtt = "WEBVTT\n\n00:00:02.000 --> 00:00:04.000\nПервая\n\n00:00:40.000 --> 00:00:42.000\nВторая\n";
    expect(subtitlesToText(vtt)).toBe("[0:02|2] Первая Вторая");

    const { uploadText } = await import("@/server/materials");
    expect((await uploadText({ name: "lecture.srt", content: srt })).content).toContain("[0:01|1]");
  });

  it("reviews pasted code with line numbers and keeps it for a topic", async () => {
    const brief = await import("@/server/brief");
    const { briefSystem } = await import("@/server/brief-prompts");
    expect(briefSystem("review", 5)).toContain("## Ошибки и риски");
    const id = await brief.writeBrief(brief.checkInput({ kind: "review", code: "def f(x):\n    return x / 0\n", topic: "ошибки" }), () => {});
    const b = brief.getBrief(id)!;
    expect(b.kind).toBe("review");
    expect(b.title).toBe("Разбор: ошибки");
    expect(b.materials?.[0].name).toBe("вставленный код");
    await expect(brief.writeBrief(brief.checkInput({ kind: "review" }), () => {})).rejects.toThrow(/Вставь код/);
  });
});
