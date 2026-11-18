// The semester calendar. Like the study plan, it is not stored: modules are
// laid over the weeks by their hours every time it is shown, so the plan for
// what is left follows the learner — behind or ahead — by itself.
import { startOfDay } from "../stats";
import type { schema } from "../db";

type ModuleRow = typeof schema.semesterModules.$inferSelect;

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export interface WeekPlan {
  week: number;
  /** Local midnight of the week's first day. */
  start: number;
  moduleIds: number[];
  midterm: boolean;
  final: boolean;
}

export interface Calendar {
  /** 1-based; 0 before the start, weeks + 1 after the end. */
  currentWeek: number;
  weeks: WeekPlan[];
  /** Modules that should be closed by now. */
  expectedPassed: number;
  passed: number;
  pace: "ahead" | "ok" | "behind" | "late";
  /** Hours per week needed for what is left in the weeks left. */
  neededPerWeek: number;
  daysLeft: number;
}

/**
 * Lay the modules (in order) over the weeks by their hours. The zero module
 * goes first; the last week is kept for the final exam when there is room,
 * and the midterm follows the module that completes half of the course.
 */
export function layout(modules: ModuleRow[], weeks: number, hoursPerWeek: number, startDate: number): WeekPlan[] {
  const plan: WeekPlan[] = Array.from({ length: weeks }, (_, i) => ({ week: i + 1, start: startDate + i * WEEK, moduleIds: [], midterm: false, final: false }));
  const regular = modules.filter((m) => m.kind === "regular");
  const learnWeeks = weeks >= 3 ? weeks - 1 : weeks;
  const total = modules.reduce((n, m) => n + m.hours, 0) || 1;
  // Hours are scaled to fit: a program larger than the time is squeezed, and the pace shows it.
  const scale = Math.min(1, (learnWeeks * hoursPerWeek) / total) || 1;
  let clock = 0;
  const half = Math.ceil(regular.length / 2);
  let regularSeen = 0;
  for (const m of modules) {
    clock += m.hours * scale;
    const week = Math.min(learnWeeks, Math.max(1, Math.ceil(clock / hoursPerWeek - 1e-9)));
    plan[week - 1].moduleIds.push(m.id);
    if (m.kind === "regular" && ++regularSeen === half && regular.length >= 3) plan[Math.min(learnWeeks, week + (week < learnWeeks ? 1 : 0)) - 1].midterm = true;
  }
  plan[weeks - 1].final = true;
  return plan;
}

export function calendar(modules: ModuleRow[], sem: { weeks: number; hoursPerWeek: number; startDate: number }, now = Date.now()): Calendar {
  const weeks = layout(modules, sem.weeks, sem.hoursPerWeek, sem.startDate);
  const today = startOfDay(now);
  const currentWeek = today < sem.startDate ? 0 : Math.min(sem.weeks + 1, Math.floor((today - sem.startDate) / WEEK) + 1);
  // Modules planned for weeks already over, plus a share of this week's by its days gone.
  let expected = 0;
  for (const w of weeks) {
    if (w.week < currentWeek) expected += w.moduleIds.length;
    else if (w.week === currentWeek) expected += Math.floor((w.moduleIds.length * Math.round((today - w.start) / DAY)) / 7);
  }
  const passed = modules.filter((m) => m.credit).length;
  const end = sem.startDate + sem.weeks * WEEK;
  const daysLeft = Math.max(0, Math.round((end - today) / DAY));
  const leftHours = modules.filter((m) => !m.credit).reduce((n, m) => n + m.hours, 0);
  const neededPerWeek = Math.round((leftHours / Math.max(1, daysLeft / 7)) * 10) / 10;
  const pace: Calendar["pace"] =
    passed === modules.length ? "ok" : daysLeft === 0 ? "late" : passed > expected ? "ahead" : passed < expected || neededPerWeek > sem.hoursPerWeek * 1.25 ? "behind" : "ok";
  return { currentWeek, weeks, expectedPassed: expected, passed, pace, neededPerWeek, daysLeft };
}
