import { handle, json } from "@/server/http";
import { activeSemesters } from "@/server/semester";

/** Running semesters and what to do in them today (home page). */
export const GET = () => handle(() => json({ semesters: activeSemesters() }));
