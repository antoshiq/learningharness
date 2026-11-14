import { getRoles, roleProblem } from "@/server/config";
import { handle, json } from "@/server/http";
import { providerFor } from "@/server/llm";
import { isText } from "@/server/llm/types";

/** Send one tiny request with the given role to check the key and model name. */
export const POST = (req: Request) =>
  handle(async () => {
    const { role } = (await req.json()) as { role: "strong" | "cheap" };
    const cfg = getRoles()[role];
    if (!cfg) throw new Error("Неизвестная роль");
    const problem = roleProblem(cfg);
    if (problem) throw new Error(problem);
    const r = await providerFor(cfg.provider).chat({
      model: cfg.model,
      system: "Ответь одним словом.",
      messages: [{ role: "user", content: [{ type: "text", text: "Скажи: работает" }] }],
      maxTokens: 2000,
    });
    return json({ ok: true, reply: r.content.filter(isText).map((b) => b.text).join("").slice(0, 100) });
  });
