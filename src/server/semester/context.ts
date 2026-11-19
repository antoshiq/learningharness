// What a lesson in a semester module is told: where the module sits in the
// course, which book pages each section is taught from, and how to use them.
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { LEVELS } from "@/lib/semester";
import { ROLE_LABEL } from "../book-read";
import type { Db } from "../db";
import { schema } from "../db";

type Topic = typeof schema.topics.$inferSelect;

export function semesterContext(db: Db, topic: Topic): string {
  if (!topic.semesterModuleId) return "";
  const m = db.select().from(schema.semesterModules).where(eq(schema.semesterModules.id, topic.semesterModuleId)).get();
  if (!m) return "";
  const sem = db.select().from(schema.semesters).where(eq(schema.semesters.id, m.semesterId)).get();
  if (!sem) return "";
  const books = db
    .select()
    .from(schema.books)
    .where(and(eq(schema.books.semesterId, sem.id), eq(schema.books.status, "ready")))
    .orderBy(asc(schema.books.id))
    .all();
  const refs = [...new Set(m.sections.flatMap((s) => s.refs))];
  const secs = refs.length ? db.select().from(schema.bookSections).where(inArray(schema.bookSections.id, refs)).all() : [];
  const bookName = new Map(books.map((b) => [b.id, b.name]));
  const threshold = m.kind === "prereq" ? 70 : LEVELS[sem.level].threshold;

  const out: string[] = [];
  if (m.kind === "prereq") {
    out.push(
      `Это нулевой модуль семестра «${sem.title}»: то, на что опирается курс. Ученик прошёл входной тест, и эти идеи оказались слабыми. Подтяни их быстро и по делу — курс начнётся, когда модуль будет сдан (порог ${threshold}%).`,
    );
  } else {
    out.push(`Это модуль ${m.idx} семестра «${sem.title}». ${LEVELS[sem.level].depth}`);
    if (sem.goal) out.push(`Цель ученика на семестр: ${sem.goal}`);
    out.push(
      `Цель — чтобы ученик знал модуль целиком и надёжно. План модуля составлен по программе семестра и охватывает все её разделы: не убирай идеи и не считай их известными без проверки. Закрыть модуль ученик может только контрольной (порог ${threshold}%); когда все идеи освоены, предложи её — кнопка «Контрольная» на странице модуля.`,
    );
  }

  out.push("", "Разделы модуля:");
  m.sections.forEach((s, i) => {
    const where = s.refs
      .map((r) => secs.find((x) => x.id === r))
      .filter((x): x is (typeof secs)[number] => !!x && bookName.has(x.bookId))
      .map((x) => `«${bookName.get(x.bookId)}» (b${x.bookId}), стр. ${x.pageFrom}–${x.pageTo}`);
    out.push(`${i + 1}. ${s.title}${s.summary ? ` — ${s.summary}` : ""}: ${where.length ? where.join("; ") : "нет в книгах ученика — объясняй сам и скажи, что в его материалах этого нет"}`);
  });
  if (m.guide) out.push("", "Путеводитель по модулю (составлен по книгам):", m.guide);

  if (books.length) {
    out.push(
      "",
      `Книги семестра: ${books.map((b) => `b${b.id} «${b.name}» — ${ROLE_LABEL[b.role]}, ${b.pages} ${b.format === "pdf" ? "стр." : "фрагм."}`).join("; ")}.`,
      "Как учить по книгам: перед объяснением раздела прочитай его страницы инструментом read_book и опирайся на книгу — её определения, обозначения и порядок изложения. Ссылайся на страницы («см. стр. 142»), чтобы ученик мог открыть книгу. Для проверок бери и упражнения из книг, указывая номер и страницу. Если нужно найти, где в книге что-то есть, — search_book. Не приписывай книге того, чего не прочитал.",
      "Теория в семестре: это полный курс, поэтому излагай раздел полно, шагами теории, — так, чтобы по твоему объяснению можно было учиться, не открывая книгу. Давай определения и формулировки теорем точно, как в книге (с её номерами и обозначениями), доказательства и выводы — по книге, объясняя переходы, которые книга пропускает. Где книга излагает сжато или тяжело, добавь интуицию и свой пример. Длинные доказательства и дополнительные примеры можно предложить прочитать в книге самому, указав страницы, а затем обсудить.",
    );
  } else {
    out.push(
      "",
      "Теория в семестре: это полный курс, поэтому излагай каждый раздел полно, шагами теории, с точными определениями и формулировками, выводами и доказательствами там, где они нужны для понимания.",
    );
  }

  const done = db
    .select({ title: schema.semesterModules.title })
    .from(schema.semesterModules)
    .where(and(eq(schema.semesterModules.semesterId, sem.id), isNotNull(schema.semesterModules.credit), eq(schema.semesterModules.kind, "regular")))
    .orderBy(asc(schema.semesterModules.idx))
    .all();
  if (done.length) out.push("", `Уже сдано в семестре: ${done.map((d) => d.title).join("; ")}. На это можно опираться и ссылаться.`);
  return out.join("\n");
}
