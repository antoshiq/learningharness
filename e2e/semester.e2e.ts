// A semester from a textbook: the program, the placement test, a module closed early, homework.
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});
test.afterAll(async () => {
  await page.close();
});

/** Answer every question of an exam (the scripted model asks "3 + 4" and a free one), then grade free answers as right. */
async function takeExam() {
  await page.getByRole("button", { name: "Начать", exact: true }).click();
  const submit = page.getByRole("button", { name: /^(Ответить|Ответить и завершить)$/ });
  await expect(submit).toBeVisible({ timeout: 60_000 });
  while (await submit.count()) {
    const radios = page.getByRole("radio");
    if (await radios.count()) {
      const labels = await radios.allInnerTexts();
      const pos = labels.findIndex((l) => l.split("\n").map((s) => s.trim()).includes("7"));
      await radios.nth(Math.max(0, pos)).click();
    } else {
      await page.getByPlaceholder("Твой ответ своими словами").fill("Результат сложения.");
    }
    await submit.click();
    await page.waitForTimeout(300);
  }
  // Free answers are graded by the learner; each button disappears once used.
  const right = page.getByRole("button", { name: "Верно", exact: true });
  for (let i = 0; i < 20 && (await right.count()); i++) {
    await right.first().click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await expect(page.getByText(/^(Сдано|Не сдано)$/)).toBeVisible();
}

test("builds a program from a PDF textbook and lets it be edited", async () => {
  await page.goto("/semester");
  await page.getByPlaceholder(/Матанализ, полный курс/).fill("Матанализ");
  await page.locator("input[type=file]").setInputFiles(path.join(__dirname, "..", "tests", "fixtures", "book.pdf"));
  await expect(page.getByLabel("Роль файла book.pdf")).toHaveValue("main");
  await page.getByRole("button", { name: "Составить программу" }).click();
  await expect(page).toHaveURL(/\/semester\/\d+$/);
  await expect(page.getByText("Проверь программу")).toBeVisible({ timeout: 60_000 });
  // Sections are tied to book pages; front matter is not offered.
  await expect(page.getByText(/book\.pdf · стр\. \d/).first()).toBeVisible();
  await expect(page.getByLabel("Название модуля").filter({ hasText: "Оглавление" })).toHaveCount(0);

  await page.getByLabel("Название модуля").first().fill("Множества и отображения");
  await page.getByRole("button", { name: "Сохранить программу" }).click();
  await expect(page.getByText("Есть несохранённые правки")).toHaveCount(0);
  await page.getByRole("button", { name: /Утвердить программу/ }).click();
  await expect(page.getByText("Ведомость")).toBeVisible();
  await expect(page.getByText(/Календарь: неделя 1 из 12/)).toBeVisible();
});

test("starts with the placement test", async () => {
  await page.getByRole("link", { name: /Входной тест/ }).first().click();
  await expect(page).toHaveURL(/kind=placement/);
  await takeExam();
  await page.getByRole("link", { name: "К семестру" }).click();
  await expect(page.getByText("Ведомость")).toBeVisible();
  await expect(page.getByRole("cell", { name: /Входной тест · Нулевой модуль/ })).toBeVisible();
});

test("closes the first module early with its checkpoint", async () => {
  await expect(page.getByRole("link", { name: "Сдать досрочно" }).first()).toBeVisible({ timeout: 30_000 });
  const rows = page.getByRole("listitem").filter({ hasText: "Множества и отображения" });
  await rows.getByRole("link", { name: "Сдать досрочно" }).click();
  await expect(page).toHaveURL(/kind=checkpoint/);
  await takeExam();
  await page.getByRole("link", { name: "К семестру" }).click();
  await expect(page.getByRole("cell", { name: /Контрольная · Множества и отображения/ })).toBeVisible();
});

test("the module's topic links back to the semester", async () => {
  const row = page.getByRole("listitem").filter({ hasText: "Множества и отображения" });
  await row.getByRole("link", { name: "Модуль", exact: true }).click();
  await expect(page).toHaveURL(/\/topics\/\d+$/);
  await expect(page.getByText(/Модуль 1 семестра «.+» · сдан/)).toBeVisible();
});
