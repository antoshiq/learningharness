import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractDocx, extractIpynb, extractPptx, isZip, readZipEntries } from "../src/server/documents";
import { LESSON_BUDGET, uploadText } from "../src/server/materials";
import { encodeRawImagePng } from "../src/server/ocr";
import { parseQuestions } from "../src/server/questions";
import { toolDefs } from "../src/server/agent/tools";
import { buildCodeMirrorSqlSchema, parseSqlSchemaHints } from "../src/lib/sql-schema";
import { sandboxLanguage } from "../src/lib/sandbox";
import { photoType } from "../src/server/vision";

/** Build a valid minimal ZIP archive (deflated) in memory for testing .docx / .pptx readers. */
function makeZip(files: Record<string, Buffer | string>): Buffer {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;

  for (const [name, raw] of Object.entries(files)) {
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const compressed = zlib.deflateRawSync(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    nameBuf.copy(cd, 46);

    localParts.push(local, compressed);
    cdParts.push(cd);
    offset += local.length + compressed.length;
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const count = Object.keys(files).length;
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

describe("university document extraction (.docx, .pptx, .ipynb, images)", () => {
  it("extracts headings, paragraphs, tables and footnotes from .docx", async () => {
    const docx = makeZip({
      "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Лабораторная работа 1</w:t></w:r></w:p>
            <w:p><w:r><w:t>Нормализация отношений &amp; SQL-запросы.</w:t></w:r></w:p>
            <w:tbl>
              <w:tr><w:tc><w:p><w:r><w:t>Форма</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Условие</w:t></w:r></w:p></w:tc></w:tr>
              <w:tr><w:tc><w:p><w:r><w:t>1НФ</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Атомарные значения</w:t></w:r></w:p></w:tc></w:tr>
            </w:tbl>
          </w:body>
        </w:document>`,
      "word/footnotes.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:footnote w:id="1"><w:p><w:r><w:t>По Кодду (1970)</w:t></w:r></w:p></w:footnote>
        </w:footnotes>`,
    });

    expect(isZip(docx)).toBe(true);
    expect(readZipEntries(docx).has("word/document.xml")).toBe(true);

    const text = await extractDocx(docx, { useVision: false });
    expect(text).toContain("# Лабораторная работа 1");
    expect(text).toContain("Нормализация отношений & SQL-запросы.");
    expect(text).toContain("| Форма | Условие |");
    expect(text).toContain("| 1НФ | Атомарные значения |");
    expect(text).toContain("По Кодду (1970)");

    const uploaded = await uploadText({ name: "lab1.docx", content: docx.toString("base64"), base64: true });
    expect(uploaded.content).toContain("# Лабораторная работа 1");

    const steps: string[] = [];
    await uploadText(
      { name: "lab1.docx", content: docx.toString("base64"), base64: true },
      { skipVision: true, onProgress: (s) => steps.push(s) },
    );
    expect(steps.some((s) => s.includes("Word"))).toBe(true);
  });

  it("extracts slides in order, tables and speaker notes from .pptx", async () => {
    const pptx = makeZip({
      "ppt/slides/slide2.xml": `<p:sld xmlns:p="x" xmlns:a="y"><a:p><a:r><a:t>Второй слайд</a:t></a:r></a:p></p:sld>`,
      "ppt/slides/slide1.xml": `<p:sld xmlns:p="x" xmlns:a="y">
        <a:p><a:r><a:t>Индексы B-Tree</a:t></a:r></a:p>
        <a:tbl>
          <a:tr><a:tc><a:t>Операция</a:t></a:tc><a:tc><a:t>Сложность</a:t></a:tc></a:tr>
          <a:tr><a:tc><a:t>Поиск</a:t></a:tc><a:tc><a:t>O(log n)</a:t></a:tc></a:tr>
        </a:tbl>
      </p:sld>`,
      "ppt/notesSlides/notesSlide1.xml": `<p:notes xmlns:p="x" xmlns:a="y"><a:p><a:r><a:t>Упомянуть про кластерный индекс</a:t></a:r></a:p></p:notes>`,
    });

    const text = await extractPptx(pptx, { useVision: false });
    const i1 = text.indexOf("[Слайд 1]");
    const i2 = text.indexOf("[Слайд 2]");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1);
    expect(text).toContain("| Операция | Сложность |");
    expect(text).toContain("Упомянуть про кластерный индекс");
  });

  it("extracts Jupyter notebooks (.ipynb) into clean markdown and code blocks", async () => {
    const nb = JSON.stringify({
      metadata: { kernelspec: { language: "python" } },
      cells: [
        { cell_type: "markdown", source: ["# Лаба 2\n", "Метод Гаусса"] },
        {
          cell_type: "code",
          source: ["print(2 + 2)"],
          outputs: [{ output_type: "stream", text: ["4\n"] }],
        },
      ],
    });
    const out = extractIpynb(nb);
    expect(out).toContain("# Лаба 2");
    expect(out).toContain("```python\nprint(2 + 2)\n```");
    expect(out).toContain("4");

    const up = await uploadText({ name: "lab2.ipynb", content: nb });
    expect(up.content).toContain("```python");
  });

  it("encodes color RGB/RGBA raw images to valid PNGs and uses raised lesson budget", () => {
    const rgb = encodeRawImagePng({ data: new Uint8Array(4 * 4 * 3).fill(120), width: 4, height: 4, channels: 3 });
    expect(photoType(rgb)).toBe("image/png");
    const rgba = encodeRawImagePng({ data: new Uint8Array(4 * 4 * 4).fill(200), width: 4, height: 4, channels: 4 });
    expect(photoType(rgba)).toBe("image/png");
    expect(LESSON_BUDGET).toBe(250_000);
  });
});

describe("SQL (PostgreSQL) support", () => {
  it("recognizes SQL in sandbox helpers, question parser, and tool schema", () => {
    expect(sandboxLanguage("sql")).toBe("sql");
    expect(sandboxLanguage("postgresql")).toBe("sql");
    expect(sandboxLanguage("postgres")).toBe("sql");

    const parsed = parseQuestions(
      JSON.stringify([{ kind: "predict_output", language: "sql", prompt: "Что вернёт запрос?", code: "SELECT 1 AS x;" }]),
      "practice",
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].language).toBe("sql");

    const ask = toolDefs("topic").find((t) => t.name === "ask_question")!;
    const props = (ask.schema as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(props.language.enum).toContain("sql");
  });

  it("executes real PostgreSQL queries and DO $$ assertions via PGlite", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite();
    try {
      const res = await pg.exec(
        `
        CREATE TABLE students (id SERIAL PRIMARY KEY, name TEXT, score INT);
        INSERT INTO students (name, score) VALUES ('Алиса', 95), ('Боб', 82), ('Вера', 95);
        SELECT name, DENSE_RANK() OVER (ORDER BY score DESC) AS rnk FROM students ORDER BY rnk, name;
        `,
        { rowMode: "array" },
      );
      const last = res.at(-1)!;
      expect(last.fields.map((f) => f.name)).toEqual(["name", "rnk"]);
      expect(last.rows).toEqual([
        ["Алиса", 1],
        ["Вера", 1],
        ["Боб", 2],
      ]);

      await expect(
        pg.exec(`DO $$ BEGIN IF (SELECT count(*) FROM students) <> 3 THEN RAISE EXCEPTION 'bad count'; END IF; END $$;`),
      ).resolves.toBeTruthy();

      await expect(
        pg.exec(`DO $$ BEGIN RAISE EXCEPTION 'Ожидалось другое значение'; END $$;`),
      ).rejects.toThrow("Ожидалось другое значение");

      // Catalog schema inspection (PK, FK, types, views)
      await pg.exec(`
        CREATE TABLE groups (id SERIAL PRIMARY KEY, title TEXT NOT NULL);
        CREATE TABLE members (id INT PRIMARY KEY, group_id INT REFERENCES groups(id), note TEXT);
        CREATE VIEW v_members AS SELECT id, group_id FROM members;
      `);
      const schemaRows = await pg.query<{ table_name: string; table_kind: string; column_name: string; is_pk: boolean; fk_ref: string | null }>(`
        SELECT
          c.relname AS table_name,
          CASE c.relkind WHEN 'v' THEN 'view' ELSE 'table' END AS table_kind,
          a.attname AS column_name,
          EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS is_pk,
          (SELECT fc.relname || '.' || fa.attname FROM pg_constraint con JOIN pg_class fc ON fc.oid = con.confrelid JOIN pg_attribute fa ON fa.attrelid = fc.oid AND fa.attnum = con.confkey[1] WHERE con.conrelid = c.oid AND con.contype = 'f' AND con.conkey[1] = a.attnum LIMIT 1) AS fk_ref
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v') AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY c.relname, a.attnum;
      `);
      const memberGroup = schemaRows.rows.find((r) => r.table_name === "members" && r.column_name === "group_id");
      expect(memberGroup?.fk_ref).toBe("groups.id");
      expect(schemaRows.rows.find((r) => r.table_name === "members" && r.column_name === "id")?.is_pk).toBe(true);
      expect(schemaRows.rows.some((r) => r.table_name === "v_members" && r.table_kind === "view")).toBe(true);
    } finally {
      await pg.close();
    }
  });

  it("extracts static SQL schema hints for CodeMirror autocomplete and merges live schema", () => {
    const hints = parseSqlSchemaHints([
      {
        name: "schema.sql",
        content: `
          -- CREATE TABLE ignored (x INT);
          CREATE TABLE IF NOT EXISTS students (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            gpa NUMERIC(4, 2),
            CONSTRAINT gpa_ok CHECK (gpa >= 0)
          );
          CREATE TABLE "courses" (code TEXT PRIMARY KEY, title TEXT);
        `,
      },
    ]);
    expect(hints.students).toEqual(["id", "name", "gpa"]);
    expect(hints.courses).toEqual(["code", "title"]);
    expect(hints.ignored).toBeUndefined();

    const merged = buildCodeMirrorSqlSchema(
      [{ name: "schema.sql", content: "CREATE TABLE students (id INT);" }],
      [{ name: "students", kind: "table", columns: [{ name: "id", type: "integer", notNull: true, pk: true, fk: null }, { name: "score", type: "integer", notNull: false, pk: false, fk: null }] }],
    );
    expect(merged.students).toEqual(["id", "score"]);
  });
});
