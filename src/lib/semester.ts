// Semester constants shared by the server and the pages.
import type { AssessmentKind, BookRole, SemesterLevel } from "@/server/db/schema";

export const LEVELS: Record<SemesterLevel, { label: string; hint: string; threshold: number; depth: string }> = {
  base: {
    label: "Базовый",
    hint: "идеи и интуиция, типовые задачи",
    threshold: 80,
    depth: "Базовый уровень: главное — понимание идей и уверенное решение типовых задач. Доказательства — на уровне идеи, без громоздких выкладок. Только ядро курса.",
  },
  standard: {
    label: "Стандартный",
    hint: "как в хорошем вузе",
    threshold: 85,
    depth: "Стандартный уровень, как в хорошем университетском курсе: определения и теоремы с доказательствами ключевых утверждений, задачи от типовых до средних. Ядро курса и важные дополнения.",
  },
  advanced: {
    label: "Продвинутый",
    hint: "строго, нестандартные задачи",
    threshold: 90,
    depth: "Продвинутый уровень: строгие определения и полные доказательства, нестандартные и олимпиадного типа задачи, тонкие места и контрпримеры. Ядро курса и дополнительные разделы.",
  },
};

export const ROLES: Record<BookRole, string> = {
  main: "Основной учебник",
  problems: "Задачник",
  lectures: "Конспект лекций",
  extra: "Дополнительно",
};

export const ASSESSMENT_LABEL: Record<AssessmentKind, string> = {
  placement: "Входной тест",
  checkpoint: "Контрольная",
  midterm: "Промежуточный экзамен",
  final: "Итоговый экзамен",
  homework: "Домашнее задание",
};

/** Weights of the final grade; missing parts are left out and the rest renormalized. */
export const GRADE_WEIGHTS: Partial<Record<AssessmentKind, number>> = { checkpoint: 0.4, homework: 0.2, midterm: 0.15, final: 0.25 };

/** Percent to the usual 2–5 grade. */
export function gradeOf(pct: number): { mark: 2 | 3 | 4 | 5; label: string } {
  if (pct >= 85) return { mark: 5, label: "отлично" };
  if (pct >= 70) return { mark: 4, label: "хорошо" };
  if (pct >= 55) return { mark: 3, label: "удовлетворительно" };
  return { mark: 2, label: "неудовлетворительно" };
}

/** A failed checkpoint can be retaken after this pause, with mistakes worked through in between. */
export const RETAKE_PAUSE_MS = 20 * 3_600_000;

/** Levels of knowing an idea, from first contact to lasting. */
export const MASTERY_STEPS = ["изучено", "проверено", "объяснено", "закреплено"] as const;
/** An idea counts as lasting when its review interval reaches this many days. */
export const LASTING_DAYS = 21;
