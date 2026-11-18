"use client";

import type { SemesterView } from "@/server/semester";
import { Card } from "./ui";

/** The running semester: modules, calendar, grade book. */
export function SemesterActive({ s }: { s: SemesterView; onChange: () => void }) {
  return (
    <Card>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        {s.modules.map((m) => (
          <li key={m.id}>{m.title}</li>
        ))}
      </ol>
    </Card>
  );
}
