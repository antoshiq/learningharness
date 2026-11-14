import { getRoles } from "@/server/config";
import { handle, json } from "@/server/http";
import { inputPrice } from "@/server/llm/pricing";
import { scanRepo } from "@/server/repo/scan";

/** Preview what the agent would be able to read, and what reading it all would cost. */
export const POST = (req: Request) =>
  handle(async () => {
    const { path: p } = (await req.json()) as { path?: string };
    if (!p?.trim()) throw new Error("Укажи путь к папке");
    let scan;
    try {
      scan = scanRepo(p.trim());
    } catch (e) {
      throw new Error(`Не удалось прочитать папку: ${e instanceof Error ? e.message : e}`);
    }
    const role = getRoles().strong;
    const price = role.provider === "anthropic" ? inputPrice(role.model) : null;
    return json({
      root: scan.root,
      files: scan.files.length,
      totalBytes: scan.totalBytes,
      estTokens: scan.estTokens,
      byExt: scan.byExt.slice(0, 8),
      skippedSecrets: scan.skippedSecrets,
      skippedLarge: scan.skippedLarge,
      truncated: scan.truncated,
      model: role.model,
      /** USD to read every file once; the agent normally reads a fraction. */
      fullReadCost: price === null ? null : (scan.estTokens * price) / 1_000_000,
    });
  });
