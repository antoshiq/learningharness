import { deleteCard } from "@/server/cards";
import { handle, json } from "@/server/http";

export const DELETE = (req: Request) =>
  handle(async () => {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) throw new Error("Некорректный идентификатор");
    deleteCard(id);
    return json({ ok: true });
  });
