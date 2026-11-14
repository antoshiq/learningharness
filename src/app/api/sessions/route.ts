import { handle, json } from "@/server/http";
import { createSession } from "@/server/sessions";

export const POST = (req: Request) =>
  handle(async () => {
    const b = (await req.json()) as { topicId: number; kind: "lesson" | "practice" | "review"; goal?: string; plannedMinutes?: number };
    if (!["lesson", "practice", "review"].includes(b.kind)) throw new Error("Неизвестный тип сессии");
    const minutes = Number.isFinite(b.plannedMinutes) ? Math.max(5, Math.min(180, Math.round(b.plannedMinutes!))) : null;
    return json({ id: createSession({ topicId: Number(b.topicId), kind: b.kind, goal: b.goal, plannedMinutes: minutes }) });
  });
