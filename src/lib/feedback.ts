// Marks on lesson steps, shared by the page and the server.
export type StepFeedbackKind = "unclear" | "too_long" | "wrong";
export const FEEDBACK_KINDS: StepFeedbackKind[] = ["unclear", "too_long", "wrong"];
export const FEEDBACK_LABEL: Record<StepFeedbackKind, string> = { unclear: "непонятно", too_long: "слишком длинно", wrong: "ошибка в объяснении" };

/** The first words of a step, enough to find it again. */
export const excerptOf = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 240);
