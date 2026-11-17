import { checkInput, listBriefs, writeBrief, type BriefInput } from "@/server/brief";
import { handle, json, sse } from "@/server/http";

export const GET = () => handle(() => json({ briefs: listBriefs() }));

/** Write a new overview, streaming status lines and text; ends with {type:"saved", id}. */
export const POST = (req: Request) =>
  handle(async () => {
    const input = checkInput((await req.json()) as Partial<BriefInput>);
    return sse(async (emit) => {
      await writeBrief(input, emit);
    });
  });
