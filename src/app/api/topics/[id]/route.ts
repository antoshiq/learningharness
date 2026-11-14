import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { planView } from "@/server/agent/state";
import { getDb, schema } from "@/server/db";
import { handle, intParam, json } from "@/server/http";
import { usageTotals } from "@/server/sessions";

type Ctx = { params: Promise<{ id: string }> };

export const GET = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const db = getDb();
    const topic = db.select().from(schema.topics).where(eq(schema.topics.id, id)).get();
    if (!topic) return json({ error: "Тема не найдена" }, 404);

    const sessions = db
      .select({
        id: schema.sessions.id,
        kind: schema.sessions.kind,
        startedAt: schema.sessions.startedAt,
        endedAt: schema.sessions.endedAt,
        summary: schema.sessions.summary,
      })
      .from(schema.sessions)
      .where(eq(schema.sessions.topicId, id))
      .orderBy(desc(schema.sessions.id))
      .all();

    const answered = db
      .select()
      .from(schema.attempts)
      .where(and(eq(schema.attempts.topicId, id), isNotNull(schema.attempts.outcome)))
      .orderBy(desc(schema.attempts.id))
      .all()
      .filter((a) => a.outcome !== "skipped");

    // Calibration: how often the learner is right at each confidence level.
    const calibration = [1, 2, 3].map((level) => {
      const at = answered.filter((a) => a.confidence === level && a.purpose !== "predict");
      return { level, total: at.length, correct: at.filter((a) => a.outcome === "correct").length };
    });

    const mistakes = answered
      .filter((a) => a.outcome === "wrong" || a.outcome === "partial")
      .slice(0, 100)
      .map((a) => ({
        id: a.id,
        nodeKey: a.nodeKey,
        kind: a.kind,
        purpose: a.purpose,
        prompt: a.question.prompt,
        outcome: a.outcome,
        confidence: a.confidence,
        misconceptionType: a.misconceptionType,
        misconception: a.misconception,
        at: a.answeredAt ?? a.createdAt,
      }));

    return json({
      topic,
      plan: planView(db, id),
      sessions,
      mistakes,
      calibration,
      parking: db.select().from(schema.parking).where(eq(schema.parking.topicId, id)).orderBy(desc(schema.parking.id)).all(),
      usage: usageTotals({ topicId: id }),
    });
  });

export const DELETE = (_req: Request, ctx: Ctx) =>
  handle(async () => {
    const id = intParam((await ctx.params).id);
    const db = getDb();
    db.transaction((tx) => {
      const ids = tx.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.topicId, id)).all().map((r) => r.id);
      if (ids.length) {
        tx.delete(schema.sideMessages).where(inArray(schema.sideMessages.sessionId, ids)).run();
        tx.delete(schema.usage).where(inArray(schema.usage.sessionId, ids)).run();
      }
      tx.delete(schema.attempts).where(eq(schema.attempts.topicId, id)).run();
      tx.delete(schema.parking).where(eq(schema.parking.topicId, id)).run();
      tx.delete(schema.sessions).where(eq(schema.sessions.topicId, id)).run();
      tx.delete(schema.nodes).where(eq(schema.nodes.topicId, id)).run();
      tx.delete(schema.topics).where(eq(schema.topics.id, id)).run();
    });
    return json({ ok: true });
  });
