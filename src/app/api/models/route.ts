import { PROVIDERS } from "@/server/config";
import { handle, json } from "@/server/http";
import { providerFor } from "@/server/llm";
import type { ProviderId } from "@/lib/types";

export const GET = (req: Request) =>
  handle(async () => {
    const provider = new URL(req.url).searchParams.get("provider") as ProviderId;
    if (!PROVIDERS.includes(provider)) throw new Error("Неизвестный провайдер");
    return json({ models: await providerFor(provider).listModels() });
  });
