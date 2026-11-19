import { getDb } from "@/server/db";
import { feedbackLog } from "@/server/feedback";
import { handle, json } from "@/server/http";

/** All marks on lesson steps, newest first. */
export const GET = () => handle(() => json(feedbackLog(getDb())));
