import { getDailyGoal, getDailyLimit } from "@/server/config";
import { handle, json } from "@/server/http";
import { getStats } from "@/server/stats";

export const GET = () => handle(() => json(getStats(getDailyLimit(), Date.now(), getDailyGoal())));
