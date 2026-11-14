import { getConfig, updateConfig } from "@/server/config";
import { handle, json } from "@/server/http";

export const GET = () => handle(() => json(getConfig()));

export const PUT = (req: Request) =>
  handle(async () => {
    updateConfig(await req.json());
    return json(getConfig());
  });
