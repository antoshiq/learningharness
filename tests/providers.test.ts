// Connections without an API key: Antigravity (in place of Gemini CLI) and GitHub Copilot.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-providers-"));
process.env.TUTOR_DATA_DIR = dir;
process.env.TUTOR_SECRETS_FILE = path.join(dir, "secrets.json");
delete process.env.TUTOR_MOCK;

let config: typeof import("@/server/config");
let antigravity: typeof import("@/server/llm/antigravity");
let db: typeof import("@/server/db");

beforeAll(async () => {
  config = await import("@/server/config");
  antigravity = await import("@/server/llm/antigravity");
  db = await import("@/server/db");
});

describe("Antigravity", () => {
  it("reads model names from `agy models`", () => {
    const out = "Fetching available models...\n\x1b[1mAvailable models:\x1b[0m\n* Claude Opus 5.5 (Medium) (current)\n  Gemini 3.5 Pro (High)\n  - Gemini 3.5 Flash\n\n";
    expect(antigravity.parseModelList(out)).toEqual(["Claude Opus 5.5 (Medium)", "Gemini 3.5 Pro (High)", "Gemini 3.5 Flash"]);
    expect(antigravity.parseModelList("Fetching available models...\nError: timed out waiting for available models\n")).toEqual([]);
  });

  it("moves a saved Gemini CLI role to Antigravity", () => {
    db.getDb()
      .insert(db.schema.settings)
      .values({ key: "roles", value: { strong: { provider: "gemini-cli", model: "pro" }, cheap: { provider: "anthropic", model: "claude-haiku-5-5" } } })
      .onConflictDoUpdate({ target: db.schema.settings.key, set: { value: { strong: { provider: "gemini-cli", model: "pro" } } } })
      .run();
    expect(config.getRoles().strong).toEqual({ provider: "antigravity", model: "default" });
    expect(config.roleProblem(config.getRoles().strong)).toBeNull();
  });
});

describe("GitHub Copilot", () => {
  it("needs a GitHub sign-in, kept with the keys", () => {
    expect(config.roleProblem({ provider: "copilot", model: "gpt-5.5" })).toMatch(/Copilot/);
    config.writeSecrets({ copilot: "gho_test" });
    expect(config.getConfig().has.copilot).toBe(true);
    expect(config.roleProblem({ provider: "copilot", model: "gpt-5.5" })).toBeNull();
    config.writeSecrets({ copilot: "" });
    expect(config.getConfig().has.copilot).toBe(false);
  });

  it("can be chosen for a role", () => {
    config.updateConfig({ roles: { cheap: { provider: "copilot", model: "gpt-5.5" } } });
    expect(config.getRoles().cheap).toEqual({ provider: "copilot", model: "gpt-5.5" });
  });
});

describe("theory depth", () => {
  it("defaults to balanced, is validated and reaches the system prompt", async () => {
    const { systemPrompt } = await import("@/server/agent/prompts");
    expect(config.getTheoryDepth()).toBe("balanced");
    config.updateConfig({ theoryDepth: "detailed" });
    expect(config.getConfig().theoryDepth).toBe("detailed");
    expect(() => config.updateConfig({ theoryDepth: "huge" as never })).toThrow();
    expect(systemPrompt("lesson", "topic", "detailed")).toContain("Глубина теории: подробно");
    expect(systemPrompt("lesson", "topic", "brief")).toContain("Глубина теории: кратко");
    expect(systemPrompt("lesson", "topic")).toContain("[система] Дальше");
  });
});
