import { and, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db";
import { schema } from "../db";
import type { ToolDef } from "../llm/types";
import { initialKnownCard, applyAttempt } from "../mastery";
import { topoOrder, validatePlan } from "@/lib/plan";
import { parsonsLines } from "@/lib/grading";
import { MISCONCEPTION_TYPES, type Question, type SessionSummary } from "@/lib/types";
import { listDir, readFile, searchCode } from "../repo/tools";
import { planStateText } from "./state";

type Session = typeof schema.sessions.$inferSelect;
type Topic = typeof schema.topics.$inferSelect;

export interface ToolCtx {
  db: Db;
  session: Session;
  topic: Topic;
}

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** ask_question accepted: the turn stops and waits for the learner. */
  pendingAttemptId?: number;
  /** end_session accepted */
  ended?: boolean;
}

const AskQuestion = z
  .object({
    node_key: z.string().optional().describe("key узла плана, который проверяет вопрос. Не указывай в диагностике до создания плана."),
    purpose: z.enum(["probe", "predict", "check", "practice", "review"]),
    kind: z.enum(["choice", "free", "math", "code", "predict_output", "find_bug", "parsons"]),
    prompt: z.string().min(1).describe("Текст вопроса в Markdown. Без ответа."),
    options: z.array(z.string()).optional().describe("choice: варианты ответа"),
    correct_option: z.number().int().optional().describe("choice: индекс верного варианта, с нуля"),
    language: z.enum(["python", "javascript"]).optional().describe("для code, predict_output, find_bug, parsons"),
    code: z.string().optional().describe("predict_output: программа; find_bug: программа с ошибкой; code: заготовка"),
    solution: z.string().optional().describe("code, find_bug: эталонное решение; parsons: правильная программа"),
    tests: z.string().optional().describe("code, find_bug: проверки, выполняются после кода ученика"),
    distractors: z.array(z.string()).optional().describe("parsons: лишние неверные строки"),
    reference_answer: z.string().optional().describe("free, math: что должно быть в верном ответе (ученик не видит)"),
    hints: z.array(z.string()).max(3).optional().describe("подсказки по нарастающей"),
    explanation: z.string().optional().describe("choice: краткое пояснение, показывается после ответа"),
  })
  .superRefine((q, ctx) => {
    const need = (cond: boolean, message: string) => {
      if (!cond) ctx.addIssue({ code: "custom", message });
    };
    const runnable = ["code", "predict_output", "find_bug", "parsons"].includes(q.kind);
    if (runnable) need(!!q.language, `для kind=${q.kind} нужен language (python или javascript)`);
    if (q.kind === "choice") {
      need(!!q.options && q.options.length >= 2 && q.options.length <= 6, "choice: нужно от 2 до 6 options");
      need(
        q.correct_option !== undefined && !!q.options && q.correct_option >= 0 && q.correct_option < q.options.length,
        "choice: correct_option должен быть индексом в options",
      );
    }
    if (q.kind === "free" || q.kind === "math") need(!!q.reference_answer?.trim(), `${q.kind}: нужен reference_answer`);
    if (q.kind === "predict_output") need(!!q.code?.trim(), "predict_output: нужна программа в code");
    if (q.kind === "code" || q.kind === "find_bug") {
      need(!!q.solution?.trim(), `${q.kind}: нужен solution`);
      need(!!q.tests?.trim(), `${q.kind}: нужны tests`);
      if (q.kind === "find_bug") need(!!q.code?.trim(), "find_bug: нужна программа с ошибкой в code");
    }
    if (q.kind === "parsons") {
      const n = parsonsLines(q.solution ?? "").length;
      need(n >= 3 && n <= 14, "parsons: solution должен содержать от 3 до 14 непустых строк");
    }
  });

const SetPlan = z.object({
  nodes: z
    .array(
      z.object({
        key: z.string().describe("короткий идентификатор: латиница в нижнем регистре, цифры, дефис"),
        title: z.string().min(1).describe("название узла по-русски, до 60 символов"),
        summary: z.string().optional().describe("одна фраза: что ученик будет понимать"),
        deps: z.array(z.string()).optional().describe("key узлов-предпосылок"),
        known: z.boolean().optional().describe("true, если ученик уже показал владение в диагностике"),
      }),
    )
    .describe("все узлы плана целиком (не только изменения)"),
});

const GradeAnswer = z.object({
  attempt_id: z.number().int(),
  outcome: z.enum(["correct", "partial", "wrong"]),
  misconception_type: z.enum(MISCONCEPTION_TYPES).optional(),
  misconception: z.string().optional().describe("одна фраза: в чём именно заблуждение"),
});

const EndSession = z.object({
  learned: z.array(z.string()).describe("что освоено в этой сессии"),
  weak: z.array(z.string()).describe("слабые места"),
  next: z.string().describe("с чего начать в следующий раз"),
});

const SaveRepoMap = z.object({ overview: z.string().min(50).describe("обзор проекта в Markdown") });
const ListDir = z.object({ path: z.string().optional().describe("папка относительно корня; по умолчанию корень") });
const ReadFile = z.object({
  path: z.string(),
  start_line: z.number().int().optional(),
  end_line: z.number().int().optional().describe("за один вызов возвращается не больше 300 строк"),
});
const SearchCode = z.object({
  query: z.string().min(1),
  glob: z.string().optional().describe('ограничение по файлам, например "*.ts" или "src/**/*.py"'),
  regex: z.boolean().optional().describe("true — query это регулярное выражение; иначе точный текст"),
});

const def = (name: string, description: string, s: z.ZodType): ToolDef => {
  const schemaJson = z.toJSONSchema(s) as Record<string, unknown>;
  delete schemaJson.$schema;
  return { name, description, schema: schemaJson };
};

export function toolDefs(topicKind: "topic" | "repo"): ToolDef[] {
  const base = [
    def(
      "ask_question",
      "Показать ученику один вопрос и дождаться ответа. Единственный способ задать вопрос. После вызова ход останавливается; ответ ученика придёт как результат этого инструмента.",
      AskQuestion,
    ),
    def(
      "grade_answer",
      "Оценить ответ ученика. Обязателен для free и math. Для авто-проверенных вопросов используй, чтобы записать заблуждение (outcome при этом не меняется).",
      GradeAnswer,
    ),
    def("set_plan", "Создать или перестроить план обучения — граф узлов с зависимостями. Передавай план целиком.", SetPlan),
    def("end_session", "Завершить сессию и показать ученику итог.", EndSession),
  ];
  if (topicKind !== "repo") return base;
  return [
    ...base,
    def("list_dir", "Показать содержимое папки репозитория.", ListDir),
    def("read_file", "Прочитать файл репозитория с номерами строк.", ReadFile),
    def("search_code", "Найти текст в файлах репозитория.", SearchCode),
    def("save_repo_map", "Сохранить обзор проекта после анализа. Вызывается один раз, до диагностики.", SaveRepoMap),
  ];
}

function parse<T>(s: z.ZodType<T>, input: unknown): { ok: true; data: T } | { ok: false; error: string } {
  if (input && typeof input === "object" && "__invalid_json" in input) {
    return { ok: false, error: "Аргументы инструмента — некорректный JSON. Повтори вызов." };
  }
  const r = s.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  return {
    ok: false,
    error:
      "Некорректные аргументы: " +
      r.error.issues.map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`).join("; "),
  };
}

export function executeTool(ctx: ToolCtx, name: string, toolUseId: string, input: unknown): ToolOutcome {
  try {
    return run(ctx, name, toolUseId, input);
  } catch (e) {
    return { content: e instanceof Error ? e.message : String(e), isError: true };
  }
}

function run(ctx: ToolCtx, name: string, toolUseId: string, input: unknown): ToolOutcome {
  const { db, session, topic } = ctx;
  const err = (content: string): ToolOutcome => ({ content, isError: true });

  switch (name) {
    case "ask_question": {
      const p = parse(AskQuestion, input);
      if (!p.ok) return err(p.error);
      const q = p.data as Question;
      if (q.node_key) {
        const node = db
          .select()
          .from(schema.nodes)
          .where(and(eq(schema.nodes.topicId, topic.id), eq(schema.nodes.key, q.node_key)))
          .get();
        if (!node) return err(`Узла "${q.node_key}" нет в плане. Используй key из плана или сначала вызови set_plan.`);
      } else if (q.purpose !== "probe" && q.purpose !== "predict") {
        return err(`Для purpose=${q.purpose} нужен node_key.`);
      }
      const row = db
        .insert(schema.attempts)
        .values({
          sessionId: session.id,
          topicId: topic.id,
          nodeKey: q.node_key ?? null,
          toolUseId,
          purpose: q.purpose,
          kind: q.kind,
          question: q,
          createdAt: Date.now(),
        })
        .returning({ id: schema.attempts.id })
        .get();
      return { content: "", pendingAttemptId: row.id };
    }

    case "grade_answer": {
      const p = parse(GradeAnswer, input);
      if (!p.ok) return err(p.error);
      const a = db.select().from(schema.attempts).where(eq(schema.attempts.id, p.data.attempt_id)).get();
      if (!a || a.sessionId !== session.id) return err(`Попытки ${p.data.attempt_id} нет в этой сессии.`);
      if (!a.answer) return err("На этот вопрос ученик ещё не ответил.");
      const set: Partial<typeof schema.attempts.$inferInsert> = {
        misconceptionType: p.data.outcome === "correct" ? null : (p.data.misconception_type ?? a.misconceptionType),
        misconception: p.data.outcome === "correct" ? null : (p.data.misconception ?? a.misconception),
      };
      // Mechanical grading wins; the model only grades what code cannot.
      if (!a.autoGraded) set.outcome = p.data.outcome;
      db.update(schema.attempts).set(set).where(eq(schema.attempts.id, a.id)).run();
      const line = a.autoGraded ? null : applyAttempt(db, a.id);
      return { content: ["Записано.", line ? `[состояние] ${line}` : ""].filter(Boolean).join(" ") };
    }

    case "set_plan": {
      const p = parse(SetPlan, input);
      if (!p.ok) return err(p.error);
      const nodes = p.data.nodes.map((n) => ({ ...n, deps: n.deps ?? [], summary: n.summary ?? "" }));
      const problems = validatePlan(nodes);
      if (problems.length) return err("План отклонён: " + problems.join(" "));
      const order = topoOrder(nodes)!;
      const existing = new Map(
        db.select().from(schema.nodes).where(eq(schema.nodes.topicId, topic.id)).all().map((n) => [n.key, n]),
      );
      db.transaction((tx) => {
        for (const n of nodes) {
          const orderIdx = order.indexOf(n.key);
          const prev = existing.get(n.key);
          if (prev) {
            tx.update(schema.nodes)
              .set({ title: n.title, summary: n.summary, deps: n.deps, orderIdx })
              .where(eq(schema.nodes.id, prev.id))
              .run();
          } else {
            const known = n.known ? initialKnownCard() : null;
            tx.insert(schema.nodes)
              .values({
                topicId: topic.id,
                key: n.key,
                title: n.title,
                summary: n.summary,
                deps: n.deps,
                orderIdx,
                status: known ? "mastered" : "new",
                card: known?.card ?? null,
                dueAt: known?.dueAt ?? null,
              })
              .run();
          }
        }
        // Nodes dropped from the plan disappear; their attempts stay in the journal.
        tx.delete(schema.nodes)
          .where(and(eq(schema.nodes.topicId, topic.id), notInArray(schema.nodes.key, nodes.map((n) => n.key))))
          .run();
      });
      return { content: "План сохранён.\n" + planStateText(db, topic.id) };
    }

    case "end_session": {
      const p = parse(EndSession, input);
      if (!p.ok) return err(p.error);
      const summary: SessionSummary = p.data;
      db.update(schema.sessions).set({ summary, endedAt: Date.now() }).where(eq(schema.sessions.id, session.id)).run();
      return { content: "Сессия завершена.", ended: true };
    }

    case "save_repo_map": {
      if (topic.kind !== "repo") return err("Инструмент доступен только для репозиториев.");
      const p = parse(SaveRepoMap, input);
      if (!p.ok) return err(p.error);
      db.update(schema.topics).set({ repoMap: p.data.overview, updatedAt: Date.now() }).where(eq(schema.topics.id, topic.id)).run();
      return { content: "Карта проекта сохранена. Переходи к диагностике." };
    }

    case "list_dir":
    case "read_file":
    case "search_code": {
      if (topic.kind !== "repo" || !topic.repoPath) return err("Инструмент доступен только для репозиториев.");
      if (name === "list_dir") {
        const p = parse(ListDir, input);
        return p.ok ? { content: listDir(topic.repoPath, p.data.path ?? ".") } : err(p.error);
      }
      if (name === "read_file") {
        const p = parse(ReadFile, input);
        return p.ok ? { content: readFile(topic.repoPath, p.data.path, p.data.start_line, p.data.end_line) } : err(p.error);
      }
      const p = parse(SearchCode, input);
      return p.ok ? { content: searchCode(topic.repoPath, p.data.query, p.data.glob, p.data.regex) } : err(p.error);
    }

    default:
      return err(`Неизвестный инструмент "${name}".`);
  }
}
