import { handle, json } from "@/server/http";
import { createPlan, listPlans } from "@/server/studyplan";

export const GET = () => handle(() => json({ plans: listPlans() }));

export const POST = (req: Request) => handle(async () => json({ id: createPlan(await req.json()) }));
