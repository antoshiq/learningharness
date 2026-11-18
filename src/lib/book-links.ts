// Page references in the tutor's text ("см. стр. 142", "«Задачник», с. 12–14")
// turned into links that open the book at that page. The book is the one named
// right before the reference, else the main textbook.

export interface LinkBook {
  id: number;
  name: string;
  role: string;
}

export const BOOK_HREF = /^#book-(\d+)-(\d+)$/;

const stem = (name: string) =>
  name
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();

/** Which book a reference means: one whose name appears in the text just before it. */
function pick(before: string, books: LinkBook[]): LinkBook {
  const near = stem(before.slice(-120));
  const named = books.filter((b) => {
    const s = stem(b.name);
    const key = s.split(" ").filter((w) => w.length > 3).slice(0, 2).join(" ") || s;
    return key && near.includes(key);
  });
  return named[named.length - 1] ?? books.find((b) => b.role === "main") ?? books[0];
}

/** Markdown with page references linked; code and formulas are left alone. */
export function linkPages(text: string, books: LinkBook[]): string {
  if (!books.length) return text;
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\[[^\]]*\]\([^)]*\))/g);
  let seen = "";
  return parts
    .map((p, i) => {
      if (i % 2 === 1) {
        seen += p;
        return p;
      }
      const out = p.replace(/(?<![\p{L}\d])(стр\.|с\.)\s?(\d{1,4})(?:\s?[–—-]\s?(\d{1,4}))?/giu, (m: string, _w: string, from: string, _to: string, offset: number) => {
        const book = pick(seen + p.slice(0, offset), books);
        return `[${m}](#book-${book.id}-${from})`;
      });
      seen += p;
      return out;
    })
    .join("");
}
