// Cards, project questions, git changes and GitHub links, links and PDFs, exams,
// search, Anki export and the daily goal, against the scripted model.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { StreamEvent } from "@/lib/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-extras-"));
process.env.TUTOR_DATA_DIR = dir;
process.env.TUTOR_SECRETS_FILE = path.join(dir, "secrets.json");
process.env.TUTOR_MOCK = "1";

let brief: typeof import("@/server/brief");
let cards: typeof import("@/server/cards");
let practice: typeof import("@/server/practice");
let dbmod: typeof import("@/server/db");

const sink = () => {
  const events: StreamEvent[] = [];
  return { events, emit: (e: StreamEvent) => events.push(e) };
};

function gitRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-git-"));
  const g = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  g("init", "-q");
  fs.writeFileSync(path.join(repo, "README.md"), "# Демо\n");
  fs.writeFileSync(path.join(repo, "main.py"), "def login(user):\n    return check_password(user)\n");
  g("add", ".");
  g("commit", "-qm", "first");
  return { repo, g };
}

beforeAll(async () => {
  brief = await import("@/server/brief");
  cards = await import("@/server/cards");
  practice = await import("@/server/practice");
  dbmod = await import("@/server/db");
});

describe("cards from an overview", () => {
  it("makes valid cards, puts them in the review queue and schedules them", async () => {
    const { emit } = sink();
    const id = await brief.writeBrief(brief.checkInput({ kind: "topic", topic: "Сложение" }), emit);
    const r = await cards.makeCards({ briefId: id }, 10);
    // The malformed third card is dropped.
    expect(r.added).toBe(2);
    expect(brief.getBrief(id)!.topicId).toBe(r.topicId);

    const queue = practice.reviewQueue(r.topicId);
    expect(queue.items).toHaveLength(2);
    const choice = queue.items.find((i) => i.question.kind === "choice")!;
    expect(choice.attemptId).toBeLessThan(0);
    expect(practice.recordDrill({ attemptId: choice.attemptId, mode: "review", answer: { choice: 0 } }).outcome).toBe("wrong");
    // A wrong card shows up in mistake practice, then leaves it once solved.
    expect(practice.openMistakes(r.topicId).map((m) => m.cardId)).toEqual([choice.cardId]);
    practice.recordDrill({ attemptId: choice.attemptId, mode: "mistakes", answer: { choice: 1 } });
    expect(practice.openMistakes(r.topicId)).toHaveLength(0);
    expect(practice.reviewQueue(r.topicId).items.map((i) => i.attemptId)).not.toContain(choice.attemptId);
  });
});

describe("exam", () => {
  it("fills up with generated questions when there are too few", async () => {
    const db = dbmod.getDb();
    const now = Date.now();
    const t = db.insert(dbmod.schema.topics).values({ title: "Экзамен", createdAt: now, updatedAt: now }).returning().get();
    db.insert(dbmod.schema.nodes).values({ topicId: t.id, key: "sum", title: "Сложение", deps: [] }).run();
    const { buildExam } = await import("@/server/exam");
    const exam = await buildExam(t.id, 5, true);
    expect(exam.generated).toBe(2);
    expect(exam.items.find((i) => i.question.kind === "choice")?.node?.key).toBe("sum");
    await expect(buildExam(db.insert(dbmod.schema.topics).values({ title: "Пусто", createdAt: now, updatedAt: now }).returning().get().id, 5, false)).rejects.toThrow(/нет вопросов/);
  });
});

describe("projects", () => {
  it("answers questions about a project and continues the conversation", async () => {
    const { repo } = gitRepo();
    const { askRepo, getChat } = await import("@/server/ask");
    const { emit, events } = sink();
    const id = await askRepo({ repo, question: "Где проверяется login?" }, emit);
    expect(events.some((e) => e.type === "text")).toBe(true);
    // The file that mentions the question's word was read.
    expect(getChat(id)!.messages[1].files).toContain("main.py");
    await askRepo({ chatId: id, question: "А что в README?" }, sink().emit);
    expect(getChat(id)!.messages).toHaveLength(4);
  });

  it("overviews what changed since the last overview", async () => {
    const { repo, g } = gitRepo();
    const { emit } = sink();
    const first = await brief.writeBrief(brief.checkInput({ kind: "repo", repoPath: repo }), emit);
    expect(brief.getBrief(first)!.commit).toMatch(/^[0-9a-f]{40}$/);
    await expect(brief.writeBrief(brief.checkInput({ kind: "changes", repoPath: repo }), emit)).rejects.toThrow(/ничего не изменилось/);

    fs.appendFileSync(path.join(repo, "main.py"), "\ndef logout():\n    pass\n");
    g("commit", "-qam", "add logout");
    const ch = await brief.writeBrief(brief.checkInput({ kind: "changes", repoPath: repo }), emit);
    const b = brief.getBrief(ch)!;
    expect(b.kind).toBe("changes");
    expect(b.files).toContain("main.py");
  });

  it("recognises GitHub links and refuses folders that do not exist", async () => {
    const { parseGithub, resolveRepo } = await import("@/server/git");
    expect(parseGithub("https://github.com/owner/repo")).toMatchObject({ owner: "owner", repo: "repo", branch: null });
    expect(parseGithub("github.com/owner/repo.git")).toMatchObject({ repo: "repo" });
    expect(parseGithub("https://github.com/owner/repo/tree/dev/src")).toMatchObject({ branch: "dev" });
    expect(parseGithub("https://gitlab.com/owner/repo")).toBeNull();
    expect(parseGithub("https://github.com/owner/../etc")).toBeNull();
    await expect(resolveRepo(path.join(dir, "нет-такой-папки"))).rejects.toThrow(/не найдена/);
  });
});

describe("documents and links", () => {
  it("reads PDFs and turns HTML into text", async () => {
    const { pdfText, htmlToText } = await import("@/server/extract");
    const pdf = Buffer.from(
      "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMTQ0XSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0NCA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDEwIDEwMCBUZCAoSGVsbG8gUERGKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp0cmFpbGVyCjw8IC9Sb290IDEgMCBSID4+CiUlRU9GCg==",
      "base64",
    );
    await expect(pdfText(pdf)).rejects.toThrow(/текстового слоя/); // "Hello PDF" is too short to count
    const { emit } = sink();
    const id = await brief.writeBrief(
      brief.checkInput({ kind: "files", uploads: [{ name: "lecture.md", content: "# Лекция\nСложение чисел." }] }),
      emit,
    );
    expect(brief.getBrief(id)!.files).toEqual(["lecture.md"]);
    const page = htmlToText("<html><title>Статья</title><nav>меню</nav><main><h2>Раздел</h2><p>Текст &amp; ещё</p><script>x()</script></main></html>");
    expect(page.title).toBe("Статья");
    expect(page.text).toContain("## Раздел");
    expect(page.text).toContain("Текст & ещё");
    expect(page.text).not.toContain("меню");
    expect(page.text).not.toContain("x()");
  });

  it("refuses links to this computer and the local network", async () => {
    const { fetchUrlText } = await import("@/server/extract");
    await expect(fetchUrlText("http://127.0.0.1:3000/")).rejects.toThrow(/локальную сеть/);
    await expect(fetchUrlText("http://192.168.1.1/")).rejects.toThrow(/локальную сеть/);
    await expect(fetchUrlText("file:///C:/Windows/win.ini")).rejects.toThrow(/http/);
  });
});

describe("search, Anki and the daily goal", () => {
  it("finds overviews and cards by words", async () => {
    const { search } = await import("@/server/search");
    const hits = search("сложение");
    expect(hits.some((h) => h.kind === "brief")).toBe(true);
    expect(search("что такое сумма").some((h) => h.kind === "card")).toBe(true);
    expect(search("x")).toEqual([]);
  });

  it("exports a topic to an Anki import file", async () => {
    const { ankiExport, mdToAnkiHtml } = await import("@/server/anki");
    const topic = dbmod.getDb().select().from(dbmod.schema.cards).all()[0].topicId;
    const out = ankiExport(topic);
    expect(out.body.startsWith("#separator:tab\n#html:true\n#deck:Репетитор::")).toBe(true);
    expect(out.count).toBeGreaterThanOrEqual(2);
    expect(mdToAnkiHtml("**a** $x^2$ <b>\n```py\nprint(1)\n```")).toBe("<b>a</b> \\(x^2\\) &lt;b&gt;<br><pre><code>print(1)</code></pre>");
  });

  it("counts today's answers against the goal", async () => {
    const { updateConfig, getConfig } = await import("@/server/config");
    const { getStats } = await import("@/server/stats");
    expect(getConfig().dailyGoal).toBe(10);
    updateConfig({ dailyGoal: 3 });
    const s = getStats(null, Date.now(), getConfig().dailyGoal);
    expect(s.goal.target).toBe(3);
    expect(s.goal.today).toBe(2); // the two card answers above
    expect(s.goal.metDays).toBe(0);
    expect(() => updateConfig({ dailyGoal: 0 })).toThrow();
  });
});
