"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BookFiles, uploadBook, type BookFile } from "@/components/BookFiles";
import { Badge, Button, Card, Field, Icon, inputClass, Loading, Notice, Page, PanelTitle, Segmented, TopNav } from "@/components/ui";
import { api, plural } from "@/lib/api";
import { LEVELS } from "@/lib/semester";
import type { SemesterLevel } from "@/server/db/schema";
import type { SemesterCard } from "@/server/semester";

const STATUS: Record<SemesterCard["status"], [string, "neutral" | "accent" | "ok" | "warn"]> = {
  preparing: ["готовится", "warn"],
  draft: ["программа на проверке", "accent"],
  active: ["идёт", "ok"],
  finished: ["завершён", "neutral"],
};

const WEEKS = [
  [4, "4 недели"],
  [8, "8"],
  [12, "12"],
  [16, "16"],
] as const;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function SemestersPage() {
  const router = useRouter();
  const [list, setList] = useState<SemesterCard[] | null>(null);
  const [request, setRequest] = useState("");
  const [level, setLevel] = useState<SemesterLevel>("standard");
  const [goal, setGoal] = useState("");
  const [weeks, setWeeks] = useState(12);
  const [hours, setHours] = useState(6);
  const [start, setStart] = useState(today);
  const [files, setFiles] = useState<BookFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ semesters: SemesterCard[] }>("/api/semesters")
      .then((r) => setList(r.semesters))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const create = async () => {
    setError(null);
    setBusy("Создаю семестр…");
    try {
      const { id } = await api<{ id: number }>("/api/semesters", { body: { request, level, goal, weeks, hoursPerWeek: hours, startDate: start } });
      const failed: string[] = [];
      for (const [i, f] of files.entries()) {
        setBusy(`Загружаю ${i + 1} из ${files.length}: ${f.file.name}`);
        try {
          await uploadBook(id, f);
        } catch (e) {
          failed.push(`${f.file.name}: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (failed.length && failed.length === files.length && !request.trim()) {
        setError(`Не удалось прочитать файлы. ${failed.join(" ")}`);
        await api(`/api/semesters/${id}`, { method: "DELETE" });
        setBusy(null);
        return;
      }
      await api(`/api/semesters/${id}/prepare`, { body: {} });
      router.push(`/semester/${id}${failed.length ? `?failed=${encodeURIComponent(failed.join("\n"))}` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const can = !busy && (request.trim().length > 2 || files.length > 0);

  return (
    <>
      <TopNav tab="Семестр" icon="cap" crumbs={[{ label: "Семестр" }]} busy={!!busy} />
      <Page narrow>
        <h1 className="text-[26px] leading-tight font-normal text-bright">Семестр</h1>
        <p className="mt-1 mb-6 max-w-[66ch] text-muted">
          Полный курс до конца: программа по учебнику или по теме, модули с контрольными, промежуточный и итоговый экзамены, домашние задания и ведомость. Пропустить
          можно только то, что сдал на контрольной.
        </p>
        {error && (
          <div className="mb-4">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}

        {list === null
          ? !error && <Loading />
          : list.length > 0 && (
              <section className="mb-6 overflow-hidden rounded-md border border-border bg-surface">
                <PanelTitle>Семестры</PanelTitle>
                <ul className="divide-y divide-border">
                  {list.map((s, i) => (
                    <li key={s.id} style={{ "--i": i } as React.CSSProperties} className="enter">
                      <Link href={`/semester/${s.id}`} className="group flex flex-wrap items-center gap-2 px-3 py-2.5 hover:bg-surface-2/60">
                        <Icon name="cap" className="text-accent" />
                        <span className="min-w-0 flex-1 truncate text-bright group-hover:text-accent">{s.title}</span>
                        {s.modules > 0 && (
                          <span className="text-xs text-muted tabular-nums">
                            {s.passed} из {s.modules} {plural(s.modules, "модуля", "модулей", "модулей")}
                          </span>
                        )}
                        <Badge>{LEVELS[s.level].label}</Badge>
                        <Badge tone={STATUS[s.status][1]}>{STATUS[s.status][0]}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

        <Card className="space-y-4">
          <h2 className="text-[15px] font-semibold text-bright">Новый семестр</h2>
          <Field label="Что изучаем" hint="Можно оставить пустым, если загружаешь учебник: тогда программа — вся книга.">
            <input className={inputClass} value={request} onChange={(e) => setRequest(e.target.value)} placeholder="Матанализ, полный курс · Дискретная математика · Линейная алгебра для ML" />
          </Field>
          <div>
            <div className="mb-1 text-[13px] text-bright">Уровень</div>
            <Segmented label="Уровень" value={level} onChange={setLevel} options={(Object.keys(LEVELS) as SemesterLevel[]).map((l) => [l, LEVELS[l].label] as const)} />
            <p className="mt-1 text-[13px] text-muted">
              {LEVELS[level].hint}. Порог контрольной — {LEVELS[level].threshold}%.
            </p>
          </div>
          <Field label="Зачем (необязательно)" hint="Влияет на упор: экзамен в вузе, для себя, подготовка к ML или олимпиаде.">
            <input className={inputClass} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Сдать сессию на отлично" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[1fr_150px_170px]">
            <div>
              <div className="mb-1 text-[13px] text-bright">Длительность</div>
              <Segmented label="Длительность" value={weeks} onChange={setWeeks} options={WEEKS} />
            </div>
            <Field label="Часов в неделю">
              <input type="number" min={1} max={60} className={inputClass} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
            </Field>
            <Field label="Начало">
              <input type="date" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
          </div>
          <div>
            <div className="mb-1.5 text-[13px] text-bright">Книги и материалы (необязательно)</div>
            <BookFiles files={files} onChange={setFiles} />
            <p className="mt-1.5 text-[13px] text-muted">
              Длинные книги не помещаются в модель целиком: приложение размечает их по главам и в каждом уроке читает только нужные страницы.
            </p>
          </div>
          <Button variant="primary" onClick={create} disabled={!can}>
            <Icon name="cap" /> {busy ?? "Составить программу"}
          </Button>
          {!busy && <p className="text-xs text-muted">Программу ты проверишь и поправишь перед началом. Составление — один вызов основной модели (для книг — ещё несколько быстрой).</p>}
        </Card>
      </Page>
    </>
  );
}
