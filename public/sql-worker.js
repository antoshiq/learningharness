// Runs learner PostgreSQL in the browser (PGlite, WebAssembly). Nothing here
// touches the computer's files: Postgres lives in memory inside this worker.
// Served locally from /pglite/ (see scripts/copy-pglite.mjs) — works offline.
//
// Lesson runs: {id, code, tests}. Each run starts from a clean public schema.
// If `code` ends with a SELECT/RETURNING query and `tests` is present, its rows
// are exposed to `tests` as a temporary table `_result`.
// Sandbox runs: {sandbox: true, files, main} — supports `\i filename.sql` includes.
const MAX_OUT = 20000;
const MAX_OUT_SANDBOX = 400000;

let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      const base = self.location.origin + "/pglite/";
      const { PGlite } = await import(base + "index.js");
      const pg = new PGlite();
      await pg.waitReady;
      return pg;
    })();
  }
  return ready;
}

function formatCell(v) {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.replace("T", " ").replace(/\.000Z$/, "");
  }
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function formatTable(fields, rows, aligned) {
  const headers = fields.map((f) => f.name || "?column?");
  const grid = rows.map((r) => headers.map((_, i) => formatCell(r[i])));
  if (!aligned) {
    if (!grid.length) return headers.join(" | ") + "\n(0 rows)";
    return [headers.join(" | "), ...grid.map((r) => r.join(" | "))].join("\n");
  }
  const widths = headers.map((h, i) => Math.max(h.length, ...grid.map((r) => r[i].length)));
  const fmt = (row) => row.map((c, i) => c.padEnd(widths[i])).join(" | ").trimEnd();
  const sep = widths.map((w) => "-".repeat(w)).join("-+-");
  const lines = [fmt(headers), sep, ...grid.map(fmt)];
  lines.push(`(${grid.length} ${grid.length === 1 ? "row" : "rows"})`);
  return lines.join("\n");
}

/** Map Postgres OIDs to SQL column types for the temporary `_result` table used by lesson tests. */
function pgTypeForOid(oid) {
  if (oid === 21 || oid === 23) return "INTEGER";
  if (oid === 20) return "BIGINT";
  if (oid === 700 || oid === 701) return "DOUBLE PRECISION";
  if (oid === 1700) return "NUMERIC";
  if (oid === 16) return "BOOLEAN";
  if (oid === 1082) return "DATE";
  if (oid === 1114) return "TIMESTAMP";
  if (oid === 1184) return "TIMESTAMPTZ";
  if (oid === 114) return "JSON";
  if (oid === 3802) return "JSONB";
  return "TEXT";
}

function quoteIdent(name) {
  return '"' + String(name || "col").replace(/"/g, '""') + '"';
}

function sqlLiteral(v, oid) {
  if (v === null || v === undefined) return "NULL";
  if (oid === 16 && typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if ((oid === 20 || oid === 21 || oid === 23 || oid === 700 || oid === 701 || oid === 1700) && (typeof v === "number" || typeof v === "bigint")) {
    return String(v);
  }
  const str = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return "'" + str.replace(/'/g, "''") + "'";
}

/** Resolve `\i file.sql` directives in sandbox mode, tracking source file & line per line. */
function expandIncludes(files, entryName) {
  const byName = new Map((files || []).map((f) => [f.name, f.content]));
  const outLines = [];
  const lineMap = [];
  const stack = new Set();

  function walk(name) {
    if (stack.has(name)) throw new Error(`Циклическое подключение файла: ${name}`);
    const content = byName.get(name);
    if (content === undefined) {
      throw new Error(`Файл "${name}" не найден. Доступны: ${[...byName.keys()].join(", ") || "нет файлов"}`);
    }
    stack.add(name);
    const lines = content.replace(/\r\n?/g, "\n").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /^\s*\\i\s+(['"]?)([^'"\s]+)\1\s*;?\s*$/.exec(lines[i]);
      if (m) {
        const target = byName.has(m[2]) ? m[2] : byName.has(m[2] + ".sql") ? m[2] + ".sql" : m[2];
        walk(target);
      } else {
        outLines.push(lines[i]);
        lineMap.push({ file: name, line: i + 1 });
      }
    }
    stack.delete(name);
  }

  walk(entryName);
  return { sql: outLines.join("\n"), lineMap };
}

function errorAtFromPosition(sql, posRaw, lineMap, fallbackFile) {
  const pos = Number(posRaw);
  if (!Number.isFinite(pos) || pos < 1) return null;
  const idx = Math.min(sql.length, pos - 1);
  let line = 1;
  for (let i = 0; i < idx; i++) if (sql[i] === "\n") line++;
  if (lineMap && lineMap[line - 1]) return lineMap[line - 1];
  return { file: fallbackFile, line };
}

async function exposeLastResult(pg, lastResult) {
  if (!lastResult || !lastResult.fields || !lastResult.fields.length) return;
  const used = new Map();
  const cols = lastResult.fields.map((f, idx) => {
    const base = f.name || `col_${idx + 1}`;
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    const colName = count === 1 ? base : `${base}_${count}`;
    return { name: colName, oid: f.dataTypeID, type: pgTypeForOid(f.dataTypeID) };
  });
  const colDefs = cols.map((c) => `${quoteIdent(c.name)} ${c.type}`).join(", ");
  await pg.exec(`DROP TABLE IF EXISTS pg_temp._result; CREATE TEMP TABLE _result (${colDefs});`);
  if (lastResult.rows.length) {
    const values = lastResult.rows
      .map((row) => "(" + cols.map((c, i) => sqlLiteral(row[i], c.oid)).join(", ") + ")")
      .join(",\n");
    await pg.exec(`INSERT INTO pg_temp._result VALUES ${values};`);
  }
}

function formatPgError(err) {
  const parts = [(err && err.message) || String(err)];
  if (err && err.detail) parts.push(`Детали: ${err.detail}`);
  if (err && err.hint) parts.push(`Подсказка: ${err.hint}`);
  return parts.join("\n");
}

const SCHEMA_QUERY = `
SELECT
  c.relname AS table_name,
  CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview' ELSE 'table' END AS table_kind,
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null,
  EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)
  ) AS is_pk,
  (
    SELECT fc.relname || '.' || fa.attname
    FROM pg_constraint con
    JOIN pg_class fc ON fc.oid = con.confrelid
    JOIN pg_attribute fa ON fa.attrelid = fc.oid AND fa.attnum = con.confkey[1]
    WHERE con.conrelid = c.oid AND con.contype = 'f' AND con.conkey[1] = a.attnum
    LIMIT 1
  ) AS fk_ref
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;
`;

async function inspectSchema(pg) {
  try {
    const res = await pg.query(SCHEMA_QUERY);
    const byTable = new Map();
    for (const r of res.rows || []) {
      let t = byTable.get(r.table_name);
      if (!t) {
        t = { name: r.table_name, kind: r.table_kind, columns: [] };
        byTable.set(r.table_name, t);
      }
      t.columns.push({
        name: r.column_name,
        type: r.data_type,
        notNull: !!r.not_null,
        pk: !!r.is_pk,
        fk: r.fk_ref || null,
      });
    }
    return [...byTable.values()];
  } catch {
    return [];
  }
}

self.onmessage = async (e) => {
  const { id, code, tests, sandbox, files, main } = e.data;
  let pg;
  try {
    pg = await init();
  } catch (err) {
    ready = null;
    self.postMessage({ id, infra: true, ok: false, stdout: "", error: String((err && err.message) || err) });
    return;
  }

  const limit = sandbox ? MAX_OUT_SANDBOX : MAX_OUT;
  const mainName = sandbox ? main || "main.sql" : "code.sql";
  let source = "";
  let lineMap = null;

  try {
    if (sandbox) {
      const expanded = expandIncludes(files || [], mainName);
      source = expanded.sql;
      lineMap = expanded.lineMap;
    } else {
      source = String(code || "");
    }
  } catch (err) {
    self.postMessage({ id, ok: false, stdout: "", error: String((err && err.message) || err), errorAt: null });
    return;
  }

  self.postMessage({ id, phase: "running" });

  let out = "";
  try {
    // Always start from a clean schema and ensure no aborted transaction lingers.
    try {
      await pg.exec("ROLLBACK;");
    } catch {}
    await pg.exec("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; SET search_path TO public; DROP TABLE IF EXISTS pg_temp._result;");

    const results = source.trim() ? await pg.exec(source, { rowMode: "array" }) : [];
    const blocks = [];
    let lastSelect = null;
    const summary = [];

    for (const r of results) {
      if (r.fields && r.fields.length > 0) {
        lastSelect = r;
        blocks.push(formatTable(r.fields, r.rows, !!sandbox));
      } else if (sandbox && r.command) {
        summary.push(r.affectedRows ? `${r.command} (${r.affectedRows})` : r.command);
      }
    }

    if (blocks.length) out = blocks.join("\n\n") + "\n";
    else if (sandbox && summary.length) out = summary.join("\n") + "\n";
    if (out.length > limit) out = out.slice(0, limit) + "\n… (вывод обрезан)\n";

    if (sandbox && out) self.postMessage({ id, phase: "out", text: out });

    if (tests) {
      await exposeLastResult(pg, lastSelect);
      await pg.exec(tests);
    }

    const schema = sandbox ? await inspectSchema(pg) : undefined;
    self.postMessage({ id, ok: true, stdout: out, error: null, schema });
  } catch (err) {
    try {
      await pg.exec("ROLLBACK;");
    } catch {}
    const schema = sandbox ? await inspectSchema(pg) : undefined;
    // Only point to a line in learner's code when error happened during `source`, not `tests`.
    const inTests = tests && err && typeof err.query === "string" && err.query.trim() === String(tests).trim();
    const at = inTests ? null : errorAtFromPosition(source, err && err.position, lineMap, mainName);
    self.postMessage({ id, ok: false, stdout: out, error: formatPgError(err), errorAt: at, schema });
  }
};
