import { handle, json } from "@/server/http";
import { search } from "@/server/search";

export const GET = (req: Request) => handle(() => json({ hits: search(new URL(req.url).searchParams.get("q") ?? "") }));
