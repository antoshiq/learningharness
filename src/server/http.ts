import type { StreamEvent } from "@/lib/types";
import { TurnError } from "./agent/run";
import { LlmError } from "./llm/types";

export const json = (data: unknown, status = 200) => Response.json(data, { status });

export function errorResponse(e: unknown): Response {
  if (e instanceof TurnError) return json({ error: e.message }, e.status);
  // The daily spending cap answers 429; any other model failure is the provider's (502).
  if (e instanceof LlmError) return json({ error: e.message }, e.status === 429 ? 429 : 502);
  const message = e instanceof Error ? e.message : String(e);
  return json({ error: message }, 400);
}

/** Wrap a route body so thrown errors become JSON error responses. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Server-sent events. The work keeps running if the browser disconnects:
 * a closed tab detaches the view, it does not cancel the turn.
 */
export function sse(work: (emit: (e: StreamEvent) => void) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const emit = (e: StreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          open = false;
        }
      };
      work(emit)
        .catch((e) => emit({ type: "error", message: e instanceof Error ? e.message : String(e) }))
        .finally(() => {
          emit({ type: "done" });
          open = false;
          try {
            controller.close();
          } catch {}
        });
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

export function intParam(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Некорректный идентификатор");
  return n;
}
