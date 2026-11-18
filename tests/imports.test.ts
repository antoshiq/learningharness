// Module load order: the dev server once loaded the lesson state first, which
// reached the book tools through the model layer before their constants existed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-imports-"));
process.env.TUTOR_DATA_DIR = dir;
process.env.TUTOR_SECRETS_FILE = path.join(dir, "secrets.json");

it("loads the lesson state first without a cycle breaking the book tools", async () => {
  await import("@/server/agent/state");
  const tools = await import("@/server/agent/tools");
  const read = tools.toolDefs("topic", true).find((t) => t.name === "read_book")!;
  expect(JSON.stringify(read.schema)).toContain("не больше 8 страниц");
});

it("loads the semester routes' modules in any order", async () => {
  await import("@/server/semester/context");
  await import("@/server/books");
  await import("@/server/semester");
  expect((await import("@/server/semester/modules")).examCount("checkpoint", 4)).toBe(8);
});
