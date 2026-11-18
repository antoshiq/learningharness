// Scripted provider for offline tests (TUTOR_MOCK=1). It walks a fixed lesson
// so the whole turn loop can be exercised without a real model or API key.
import { isText, isToolResult, type Block, type LlmProvider, type LlmRequest, type LlmResult } from "./types";

let seq = 0;
const call = (name: string, input: unknown): Block => ({ type: "tool_use", id: `mock_${Date.now()}_${seq++}`, name, input });

export function mockProvider(): LlmProvider {
  return {
    id: "mock",
    async listModels() {
      return ["mock"];
    },
    async chat(req: LlmRequest): Promise<LlmResult> {
      const say = (t: string): Block => {
        req.onText?.(t);
        return { type: "text", text: t };
      };
      const done = (content: Block[]): LlmResult => ({
        content,
        stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end",
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 },
      });
      if (!req.tools?.length) {
        // Quick overview: pick files, write the overview, open a thesis.
        if (req.system.startsWith("Ты помогаешь разобраться в проекте")) return done([say('["README.md"]')]);
        if (req.system.startsWith("Ты составляешь краткий экскурс")) {
          return done([
            say(
              "## Суть\n(тест) Сложение объединяет числа в одно.\n\n## Главное\n1. **Переместительность** — от перестановки слагаемых сумма не меняется.\n2. **Ноль** — прибавление нуля не меняет число.\n\n## Как это работает\n```mermaid\nflowchart LR\n  A[\"Слагаемые\"] --> B[\"Сумма\"]\n```\n\n## Пример\n```python\nprint(2 + 2)\n```",
            ),
          ]);
        }
        if (req.system.startsWith("Ты делаешь карточки") || req.system.startsWith("Ты составляешь экзамен")) {
          const node = /(\w+) — Сложение/.exec(req.messages.map((m) => m.content.filter(isText).map((b) => b.text).join("")).join(""))?.[1];
          return done([
            say(
              JSON.stringify([
                { kind: "choice", prompt: "(тест) Чему равно $3 + 4$?", options: ["6", "7", "8"], correct_option: 1, explanation: "Сложение.", ...(node ? { node_key: node } : {}) },
                { kind: "free", prompt: "(тест) Что такое сумма?", reference_answer: "Результат сложения.", explanation: "Определение." },
                { kind: "choice", prompt: "без вариантов" },
              ]),
            ),
          ]);
        }
        if (req.system.startsWith("Ты проверяешь объяснение")) {
          const followUp = req.messages.some((m) => m.content.some((b) => isText(b) && b.text.includes("Ответ ученика на уточняющий вопрос")));
          return done([
            say(
              JSON.stringify(
                followUp
                  ? { score: 90, verdict: "correct", good: ["(тест) Теперь всё верно"], gaps: [], errors: [], followup: "", model: "(тест) Образец." }
                  : { score: 55, verdict: "partial", good: ["(тест) Суть верна"], gaps: ["(тест) Не сказано про ноль"], errors: [], followup: "(тест) Что будет, если прибавить ноль?", model: "(тест) Образец." },
              ),
            ),
          ]);
        }
        if (req.system.startsWith("Ты составляешь домашнее задание")) {
          return done([say(JSON.stringify({ title: "(тест) Домашнее задание", task: "Докажите, что $a + b = b + a$.", rubric: [{ criterion: "Верная идея", points: 6 }, { criterion: "Аккуратное оформление", points: 4 }] }))]);
        }
        if (req.system.startsWith("Ты проверяешь домашнее задание")) {
          return done([say(JSON.stringify({ scores: [{ criterion: "Верная идея", got: 6, comment: "(тест) верно" }, { criterion: "Аккуратное оформление", got: 2, comment: "(тест) небрежно" }], feedback: "(тест) Хорошо." }))]);
        }
        if (req.system.startsWith("Ты раскладываешь новую книгу")) {
          // Every book section goes to the first program section.
          const text = req.messages.map((m) => m.content.filter(isText).map((b) => b.text).join("")).join("\n");
          const first = /m\d+\.\d+/.exec(text)?.[0];
          const secs = [...text.matchAll(/^\s*(s\d+) /gm)].map((m) => m[1]);
          return done([say(JSON.stringify(first ? { [first]: secs } : {}))]);
        }
        if (req.system.startsWith("Ты готовишь модуль семестра")) {
          // Two ideas per section: "Раздел N: title" lines of the request.
          const text = req.messages.map((m) => m.content.filter(isText).map((b) => b.text).join("")).join("\n");
          const ideas: { key: string; title: string; summary: string; deps: string[]; section: number }[] = [];
          for (const m of text.matchAll(/^Раздел (\d+): (.+?)(?: — .*)?$/gm)) {
            const n = Number(m[1]);
            ideas.push({ key: `s${n}-a`, title: `${m[2]}: суть`, summary: "(тест)", deps: ideas.length ? [ideas[ideas.length - 1].key] : [], section: n });
            ideas.push({ key: `s${n}-b`, title: `${m[2]}: применение`, summary: "(тест)", deps: [`s${n}-a`], section: n });
          }
          return done([say(JSON.stringify({ ideas, guide: [{ section: 1, summary: "(тест) главное", exercises: "№ 1–3, стр. 2" }] }))]);
        }
        if (req.system.startsWith("Ты составляешь программу семестра")) {
          // One module per chapter of the outline (sections as its sections), or two modules for a bare topic.
          const text = req.messages.map((m) => m.content.filter(isText).map((b) => b.text).join("")).join("\n");
          const modules: { title: string; summary: string; hours: number; sections: { title: string; summary: string; refs: string[] }[] }[] = [];
          for (const m of text.matchAll(/^( *)s(\d+) (.+?) \(стр\./gm)) {
            const sec = { title: m[3], summary: "", refs: [`s${m[2]}`] };
            if (!m[1].length || !modules.length) modules.push({ title: m[3], summary: "(тест) модуль", hours: 4, sections: m[1].length ? [sec] : [] });
            else modules[modules.length - 1].sections.push(sec);
          }
          for (const m of modules) if (!m.sections.length) m.sections.push({ title: m.title, summary: "", refs: [] });
          if (!modules.length) {
            modules.push(
              { title: "Пределы", summary: "(тест)", hours: 6, sections: [{ title: "Предел последовательности", summary: "", refs: [] }, { title: "Предел функции", summary: "", refs: [] }] },
              { title: "Производная", summary: "(тест)", hours: 6, sections: [{ title: "Определение производной", summary: "", refs: [] }, { title: "Правила дифференцирования", summary: "", refs: [] }] },
            );
          }
          return done([
            say(
              JSON.stringify({
                title: "(тест) Курс",
                estimate_hours: 12,
                prereqs: [{ key: "functions", title: "Функции", summary: "Что такое функция" }],
                parts: [{ title: "Часть 1", modules }],
                notes: [],
                recommended: modules.some((m) => m.sections.some((s) => s.refs.length)) ? [] : ["(тест) Учебник"],
              }),
            ),
          ]);
        }
        if (req.system.startsWith("Ты извлекаешь оглавление")) {
          // Table of contents lines "Title ..... 12" become entries.
          const text = req.messages.map((m) => m.content.filter(isText).map((b) => b.text).join("")).join("\n");
          const entries = [...text.matchAll(/^(.+?)\s*\.{2,}\s*(\d+)\s*$/gm)].map((m) => ({ title: m[1].trim(), level: /^глава/i.test(m[1].trim()) ? 1 : 2, page: Number(m[2]) }));
          return done([say(JSON.stringify(entries))]);
        }
        if (req.system.startsWith("Ты отвечаешь на вопросы о проекте")) return done([say("(тест) Точка входа — `README.md:1`.")]);
        if (req.system.startsWith("Ученик читает краткий экскурс")) return done([say("(тест) Подробнее: $a + b = b + a$ для любых чисел.")]);
        return done([say("(тест) Короткий ответ на боковой вопрос.")]);
      }

      const last = req.messages[req.messages.length - 1];
      const lastText = last.content.filter(isText).map((b) => b.text).join("\n");
      const results = last.content.filter(isToolResult);
      const failed = results.find((r) => r.is_error);
      if (failed) return done([say(`(тест) Инструмент вернул ошибку: ${failed.content}`)]);
      if (lastText.includes("завершает сессию")) {
        return done([call("end_session", { learned: ["сложение"], weak: [], next: "функции" })]);
      }
      const step = req.messages.filter((m) => m.role === "assistant").length;
      const attemptId = Number(/attempt_id: (\d+)/.exec(results.map((r) => r.content).join("\n"))?.[1] ?? 0);

      switch (step) {
        case 0:
          return done([
            say("(тест) Сначала проверю, что ты уже знаешь."),
            call("ask_question", {
              purpose: "probe",
              kind: "choice",
              prompt: "Чему равно $2 + 2$?",
              options: ["3", "4", "5"],
              correct_option: 1,
              explanation: "Сложение.",
            }),
          ]);
        case 1:
          return done([
            call("set_plan", {
              nodes: [
                { key: "sum", title: "Сложение", summary: "Складывать числа" },
                { key: "func", title: "Функции", deps: ["sum"] },
                { key: "why", title: "Зачем функции", deps: ["func"] },
              ],
            }),
          ]);
        case 2:
          return done([
            say("(тест) План готов. Начнём со сложения."),
            call("ask_question", {
              node_key: "sum",
              purpose: "check",
              kind: "predict_output",
              language: "python",
              prompt: "Что напечатает программа?",
              code: "print(1 + 1)",
              hints: ["Это сложение", "1 + 1"],
            }),
          ]);
        case 3:
          return done([
            say("(тест) Теперь функция."),
            call("ask_question", {
              node_key: "func",
              purpose: "check",
              kind: "code",
              language: "python",
              prompt: "Напиши функцию `add(a, b)`.",
              code: "def add(a, b):\n    pass\n",
              solution: "def add(a, b):\n    return a + b\n",
              tests: "assert add(1, 2) == 3, 'add(1, 2) должно быть 3'",
            }),
          ]);
        case 4:
          return done([
            call("ask_question", {
              node_key: "why",
              purpose: "check",
              kind: "free",
              prompt: "Зачем нужны функции?",
              reference_answer: "Переиспользование кода",
            }),
          ]);
        case 5:
          return done([call("grade_answer", { attempt_id: attemptId, outcome: "correct" })]);
        default:
          return done([call("end_session", { learned: ["сложение", "функции"], weak: [], next: "циклы" })]);
      }
    },
  };
}
