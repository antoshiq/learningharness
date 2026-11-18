// One learner's path through the app, in order: each step builds on the last.
import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});
test.afterAll(async () => {
  await page.close();
});

/** Press the digit key of the option with this exact text (options are shuffled). */
async function pickOption(text: string) {
  const radios = page.getByRole("radio");
  await expect(radios.first()).toBeVisible();
  const labels = await radios.allInnerTexts();
  const pos = labels.findIndex((l) => l.split("\n").map((s) => s.trim()).includes(text));
  expect(pos, `option "${text}" in ${JSON.stringify(labels)}`).toBeGreaterThanOrEqual(0);
  await page.keyboard.press(String(pos + 1));
  await expect(radios.nth(pos)).toHaveAttribute("aria-checked", "true");
}

test("creates a topic and answers the first question with the keyboard", async () => {
  await page.goto("/");
  await page.getByRole("button", { name: "Новая тема" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Что будем изучать?" });
  await dialog.getByPlaceholder("Рекурсия в Python").fill("Арифметика");
  await dialog.getByRole("button", { name: "Создать тему" }).click();
  await expect(page).toHaveURL(/\/topics\/\d+$/);

  await page.getByRole("button", { name: "Начать", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Начать" }).click();
  await expect(page).toHaveURL(/\/session\/\d+$/);

  // The scripted tutor asks "2 + 2"; answer wrong on purpose to create a mistake.
  await pickOption("3");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("Неверно").first()).toBeVisible();
});

test("fixes the mistake in mistake practice", async () => {
  await page.goto("/mistakes");
  await expect(page.getByRole("heading", { name: "Работа над ошибками" })).toBeVisible();
  await page.getByRole("button", { name: "Решить заново" }).first().click();
  await pickOption("4");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("Верно", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /Исправлено 1 из 1/ })).toBeVisible();
  await expect(page.getByText("Нерешённых ошибок нет")).toBeVisible();
});

test("review queue says when nothing is due", async () => {
  await page.goto("/review");
  await expect(page.getByText(/На сегодня всё повторено|Начать/).first()).toBeVisible();
});

test("stats show today's activity and the streak", async () => {
  await page.goto("/stats");
  await expect(page.getByRole("heading", { name: "Активность за год" })).toBeVisible();
  await expect(page.getByText("1 день").first()).toBeVisible();
  await expect(page.locator(".heat-0, .heat-1, .heat-2, .heat-3, .heat-4").first()).toBeVisible();
});

test("theme toggle survives a reload", async () => {
  await page.goto("/");
  const root = page.locator("html");
  const toggle = page.getByRole("button", { name: "Сменить тему оформления" });
  await toggle.click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await toggle.click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await toggle.click();
  await expect(root).not.toHaveAttribute("data-theme", /.+/);
});

test("command palette opens with Ctrl+K and navigates", async () => {
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Палитра команд" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("статистика");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/stats$/);
  await expect(palette).toHaveCount(0);
});

test("settings: daily limit and backup download", async () => {
  await page.goto("/settings");
  const limit = page.getByLabel("Лимит в долларах в день");
  await limit.fill("1.5");
  await limit.locator("xpath=..").getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("из $1.50")).toBeVisible();

  const res = await page.request.get("/api/backup");
  expect(res.status()).toBe(200);
  expect((await res.body()).subarray(0, 15).toString()).toBe("SQLite format 3");
});

test("quick overview: write, open a thesis, continue as a topic", async () => {
  await page.goto("/brief");
  await page.getByPlaceholder("async/await в Python").fill("Сложение");
  await expect(page.getByRole("button", { name: "5 минут", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+Enter");
  await expect(page).toHaveURL(/\/brief\/\d+$/);
  await expect(page.getByRole("heading", { name: "Главное" })).toBeVisible();

  const more = page.getByRole("button", { name: "подробнее" }).first();
  await more.click();
  await expect(page.getByText("(тест) Подробнее").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "свернуть" }).first()).toHaveAttribute("aria-expanded", "true");

  await page.getByRole("button", { name: "Учить это подробно" }).click();
  await expect(page).toHaveURL(/\/topics\/\d+$/);
  await expect(page.getByRole("heading", { name: "Сложение" })).toBeVisible();
});

test("cards from an overview land in today's review", async () => {
  await page.goto("/brief");
  await page.getByPlaceholder("async/await в Python").fill("Сложение");
  await page.keyboard.press("Control+Enter");
  await expect(page).toHaveURL(/\/brief\/\d+$/);
  await page.getByRole("button", { name: "Сделать карточки" }).click();
  await expect(page.getByText("Добавлено карточек: 2")).toBeVisible();

  await page.goto("/review");
  await page.getByRole("button", { name: "Начать" }).click();
  // Answer whatever comes first: a choice card or a free card with self-grading.
  for (let i = 0; i < 2; i++) {
    const radios = page.getByRole("radio");
    if (await radios.first().isVisible().catch(() => false)) {
      await pickOption("7");
      await page.keyboard.press("Control+Enter");
    } else {
      await page.getByPlaceholder("Твой ответ своими словами").fill("результат сложения");
      await page.keyboard.press("Control+Enter");
      await page.keyboard.press("3");
    }
    await expect(page.getByText("Верно", { exact: true }).first()).toBeVisible();
    await page.keyboard.press("Enter");
  }
  await expect(page.getByRole("heading", { name: "Повторение закончено" })).toBeVisible();
});

test("exam over a topic shows results per idea", async () => {
  await page.goto("/");
  await page.getByRole("link", { name: "Обзор" }).first().click();
  await expect(page).toHaveURL(/\/topics\/\d+$/);
  await page.getByRole("link", { name: "Экзамен" }).click();
  await page.getByRole("button", { name: "10 вопросов" }).click();
  await page.getByRole("button", { name: "Без таймера" }).click();
  await page.getByRole("button", { name: "Начать экзамен" }).click();
  await expect(page.getByText(/Вопрос 1 из \d+/)).toBeVisible();
  await page.getByRole("button", { name: "Завершить досрочно" }).click();
  await expect(page.getByRole("heading", { name: "Экзамен закончен" })).toBeVisible();
  await expect(page.getByText("По идеям плана")).toBeVisible();
});

test("asks a question about a local project", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-e2e-repo-"));
  fs.writeFileSync(path.join(repo, "README.md"), "# Demo\n");
  fs.writeFileSync(path.join(repo, "auth.py"), "def login(user):\n    return True\n");

  await page.goto("/ask");
  await page.getByLabel("Проект: путь к папке или ссылка на GitHub").fill(repo);
  await page.getByLabel("Вопрос о проекте").fill("Где login?");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/ask\/\d+$/);
  await expect(page.getByText("(тест) Точка входа")).toBeVisible();
  await expect(page.getByText(/Прочитано файлов: \d+/)).toBeVisible();
});

test("palette searches everything; Anki export and the daily goal", async () => {
  await page.goto("/");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("что такое сумма");
  const palette = page.getByRole("dialog", { name: "Палитра команд" });
  await expect(palette.getByText("карточка").first()).toBeVisible();
  await page.keyboard.press("Escape");

  const topics = (await (await page.request.get("/api/topics")).json()) as { topics: { id: number }[] };
  let exported = false;
  for (const t of topics.topics) {
    const res = await page.request.get(`/api/topics/${t.id}/anki`);
    if (res.status() !== 200) continue;
    expect((await res.text()).startsWith("#separator:tab")).toBe(true);
    exported = true;
  }
  expect(exported).toBe(true);

  await expect(page.getByRole("img", { name: /Цель на день: \d+ из 10/ })).toBeVisible();
});

test("new topic with attached files: the tutor gets them as materials", async () => {
  await page.goto("/");
  await page.getByRole("button", { name: "Новая тема" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Что будем изучать?" });
  await dialog.locator('input[type="file"]').setInputFiles([
    { name: "лекция-пределы.md", mimeType: "text/markdown", buffer: Buffer.from("# Пределы\nПредел — число, к которому стремится последовательность.") },
    { name: ".env", mimeType: "text/plain", buffer: Buffer.from("SECRET=1") },
  ]);
  await expect(dialog.getByText("лекция-пределы.md")).toBeVisible();
  // Without a title the file name is used; the secret is refused with a clear message.
  await dialog.getByRole("button", { name: "Создать тему" }).click();
  await expect(dialog.getByText(/похож на файл с секретами/)).toBeVisible();
  await dialog.getByRole("button", { name: "Убрать .env" }).click();
  await dialog.getByRole("button", { name: "Создать тему" }).click();
  await expect(page).toHaveURL(/\/topics\/\d+$/);
  await expect(page.getByRole("heading", { name: "лекция-пределы" })).toBeVisible();

  await page.getByRole("tab", { name: /Материалы/ }).click();
  await expect(page.getByText("лекция-пределы.md")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "задачи.txt", mimeType: "text/plain", buffer: Buffer.from("Найти предел 1/n.") });
  await page.getByRole("button", { name: "Добавить файл" }).click();
  await expect(page.getByText("задачи.txt")).toBeVisible();
});

test("quick overview from attached files carries them into the topic", async () => {
  await page.goto("/brief");
  await page.locator('input[type="file"]').setInputFiles({ name: "ряды.md", mimeType: "text/markdown", buffer: Buffer.from("Ряд сходится, если частичные суммы имеют предел.") });
  await expect(page.getByText("ряды.md")).toBeVisible();
  await page.getByRole("button", { name: "Сделать экскурс" }).click();
  await expect(page).toHaveURL(/\/brief\/\d+$/);
  await expect(page.getByRole("heading", { name: "ряды", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Учить это подробно" }).click();
  await expect(page).toHaveURL(/\/topics\/\d+$/);
  await page.getByRole("tab", { name: /Материалы/ }).click();
  await expect(page.getByText("ряды.md")).toBeVisible();
});

test("diagrams render and code opens in the sandbox", async () => {
  await page.goto("/brief");
  await page.getByPlaceholder("async/await в Python").fill("Сложение со схемой");
  await page.keyboard.press("Control+Enter");
  await expect(page).toHaveURL(/\/brief\/\d+$/);
  await expect(page.locator(".mermaid-diagram svg")).toBeVisible({ timeout: 30_000 });

  const [sandbox] = await Promise.all([page.context().waitForEvent("page"), page.getByRole("button", { name: "▶ В песочницу" }).first().click({ force: true })]);
  await expect(sandbox).toHaveURL(/\/sandbox$/);
  await expect(sandbox.getByRole("tab", { name: "main.py" })).toBeVisible();
  await sandbox.getByRole("button", { name: "Запустить" }).click();
  await expect(sandbox.locator("pre").filter({ hasText: /^4\s*$/ })).toBeVisible({ timeout: 60_000 });
  await sandbox.close();
});

test("explain in your own words: review, follow-up, done", async () => {
  await page.goto("/");
  await page.getByRole("link", { name: "Обзор" }).first().click();
  await page.getByRole("link", { name: "Объясни своими словами" }).click();
  await expect(page).toHaveURL(/\/explain\?topic=\d+/);
  await page.getByLabel("Объяснение").waitFor();
  if (await page.getByLabel("Что объясняешь").isVisible()) await page.getByLabel("Что объясняешь").fill("сложение");
  await page.getByLabel("Объяснение").fill("Сложение объединяет два числа в одно, их сумму.");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("Есть пробелы")).toBeVisible();
  await expect(page.getByText("(тест) Что будет, если прибавить ноль?")).toBeVisible();
  await page.getByLabel("Ответ на уточняющий вопрос").fill("Если прибавить ноль, число не изменится.");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("Отлично: идея объяснена без пробелов.")).toBeVisible();
});

test("plan to a date shows today's tasks on the home page", async () => {
  await page.goto("/plan");
  await page.getByPlaceholder("Экзамен по матанализу").fill("Сессия");
  const d = new Date(Date.now() + 7 * 86_400_000);
  await page.locator('input[type="date"]').fill(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  await page.getByRole("button", { name: /Арифметика/ }).click();
  await page.getByRole("button", { name: "Составить план" }).click();
  await expect(page).toHaveURL(/\/plan\/\d+$/);
  await expect(page.getByRole("heading", { name: "План на сегодня" })).toBeVisible();
  await expect(page.getByText("осталось 7 дней")).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("План на сегодня")).toBeVisible();
  await expect(page.getByRole("link", { name: /Повторение на сегодня/ }).first()).toBeVisible();
});

test("code review is an overview kind", async () => {
  await page.goto("/brief?kind=review");
  await page.getByPlaceholder(/Вставь функцию/).fill("def f(x):\n    return x / 0\n");
  await page.getByRole("button", { name: "Сделать экскурс" }).click();
  await expect(page).toHaveURL(/\/brief\/\d+$/);
  await expect(page.getByRole("heading", { name: "Разбор: код" })).toBeVisible();
});


/** Replace everything in the visible code editor with `code`. */
async function typeCode(p: Page, code: string) {
  const editor = p.locator(".cm-content").last();
  await editor.click();
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Delete");
  // insertText avoids auto-indent and bracket closing turning the code into something else.
  await p.keyboard.insertText(code);
}

test("sandbox: several files, input, error line, stop, ask the tutor", async () => {
  await page.goto("/sandbox");
  await page.getByRole("button", { name: "JavaScript" }).click();
  await page.getByRole("button", { name: "Пример" }).click();
  await expect(page.getByRole("tab", { name: "helpers.js" })).toBeVisible();
  // main.js requires ./helpers and reads the name from the input panel.
  await page.getByRole("button", { name: "Запустить" }).click();
  await expect(page.getByText("Привет, Аня!")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: "Ввод" }).click();
  await page.getByLabel("Ввод программы").fill("Борис");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("Привет, Борис!")).toBeVisible({ timeout: 30_000 });

  await typeCode(page, "const a = 1;\nnull.foo;\n");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByRole("button", { name: "main.js, строка 2" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".cm-lint-marker-error")).toBeVisible();

  await page.getByRole("button", { name: "Спросить репетитора, почему ошибка" }).click();
  await expect(page.getByText("(тест) Короткий ответ на боковой вопрос.")).toBeVisible();

  await typeCode(page, "while (true) {}\n");
  await page.getByRole("button", { name: "Запустить" }).click();
  await page.getByRole("button", { name: "■ Остановить" }).click();
  await expect(page.getByText("Остановлено.")).toBeVisible();

  // A new file shows up as a tab and survives a reload (the draft is kept).
  await page.getByRole("button", { name: "Новый файл" }).click();
  await page.getByLabel("Имя нового файла").fill("utils");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "utils.js" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "utils.js" })).toBeVisible();
});

test("sandbox: Python errors point at the line", async () => {
  await page.goto("/sandbox");
  await page.getByRole("button", { name: "Python" }).click();
  await page.getByRole("button", { name: "Пример" }).click();
  await typeCode(page, "x = 1\nprint(y)\n");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByRole("button", { name: "main.py, строка 2" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/NameError/).first()).toBeVisible();
});

test("lesson code editor: error line, reset and full screen", async () => {
  await page.goto("/");
  await page.getByRole("link", { name: /Продолжить урок/ }).first().click();
  await expect(page).toHaveURL(/\/session\/\d+$/);
  // The scripted lesson asks to predict "print(1 + 1)" first.
  const predict = page.getByPlaceholder("Что напечатает программа? Точно, построчно");
  await predict.waitFor({ timeout: 60_000 });
  await predict.fill("2");
  await page.keyboard.press("Control+Enter");

  await expect(page.getByText("Напиши функцию")).toBeVisible({ timeout: 60_000 });
  await typeCode(page, "def add(a, b):\n    return a + c\n\nprint(add(1, 2))\n");
  await page.getByRole("button", { name: "Запустить" }).click();
  await expect(page.getByText("Ошибка в строке 2")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".cm-lint-marker-error")).toBeVisible();

  await page.getByRole("button", { name: "Сбросить" }).click();
  await expect(page.locator(".cm-content").last()).toContainText("pass");

  await page.getByRole("button", { name: "Редактор во весь экран" }).click();
  await expect(page.getByRole("button", { name: "Свернуть редактор" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Редактор во весь экран" })).toBeVisible();
});

test("switches between the minimal and the classic look, and keeps the choice", async () => {
  await page.goto("/settings");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-ui", "minimal");
  await expect(page.getByText("тестовая модель")).toBeHidden();
  await page.getByRole("group", { name: "Вид" }).getByRole("button", { name: "Подробный" }).click();
  await expect(html).toHaveAttribute("data-ui", "classic");
  await page.reload();
  await expect(html).toHaveAttribute("data-ui", "classic");
  // The status bar of the classic look shows the model.
  await expect(page.getByText("тестовая модель")).toBeVisible();
  await page.getByRole("group", { name: "Вид" }).getByRole("button", { name: "Минималистичный" }).click();
  await expect(html).toHaveAttribute("data-ui", "minimal");
});
