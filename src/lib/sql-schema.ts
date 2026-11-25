// Helpers for PostgreSQL schema inspection and CodeMirror SQL autocompletion.

export interface SqlColumnSchema {
  name: string;
  type: string;
  notNull: boolean;
  pk: boolean;
  fk: string | null;
}

export interface SqlTableSchema {
  name: string;
  kind: "table" | "view" | "matview";
  columns: SqlColumnSchema[];
}

const SQL_TABLE_CONSTRAINT = /^(constraint|primary|foreign|unique|check|exclude|like)\b/i;

/**
 * Lightweight static extraction of table and column names from CREATE TABLE
 * statements in editor files, so autocomplete works immediately even before
 * the first run. Merged with live PostgreSQL catalog metadata once executed.
 */
export function parseSqlSchemaHints(files: { name: string; content: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const createRe = /create\s+(?:temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:(?:"[^"]+"|\w+)\.)?("[^"]+"|\w+)\s*\(/gi;

  for (const f of files) {
    // Strip -- line comments and /* */ block comments so commented DDL does not pollute hints.
    const clean = f.content.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    let m: RegExpExecArray | null;
    while ((m = createRe.exec(clean))) {
      const table = m[1].replace(/^"|"$/g, "");
      let depth = 1;
      let i = createRe.lastIndex;
      const start = i;
      while (i < clean.length && depth > 0) {
        const ch = clean[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        i++;
      }
      if (depth !== 0) continue;
      const body = clean.slice(start, i - 1);
      // Split top-level comma-separated definitions (ignoring commas inside NUMERIC(10, 2), CHECK(...), etc.).
      const cols: string[] = [];
      let segStart = 0;
      let d = 0;
      for (let j = 0; j <= body.length; j++) {
        const c = body[j];
        if (c === "(") d++;
        else if (c === ")") d--;
        else if ((c === "," && d === 0) || j === body.length) {
          const def = body.slice(segStart, j).trim();
          segStart = j + 1;
          if (!def || SQL_TABLE_CONSTRAINT.test(def)) continue;
          const colMatch = /^("[^"]+"|[a-zA-Z_][\w$]*)\s+\S/.exec(def);
          if (colMatch) cols.push(colMatch[1].replace(/^"|"$/g, ""));
        }
      }
      if (cols.length) out[table] = cols;
    }
  }
  return out;
}

/** Merge static editor hints with authoritative live PostgreSQL catalog schema. */
export function buildCodeMirrorSqlSchema(
  files: { name: string; content: string }[],
  live?: SqlTableSchema[] | null,
): Record<string, string[]> {
  const merged = parseSqlSchemaHints(files);
  if (live?.length) {
    for (const t of live) {
      merged[t.name] = t.columns.map((c) => c.name);
    }
  }
  return merged;
}
