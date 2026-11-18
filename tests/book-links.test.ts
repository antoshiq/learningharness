// Page references in the tutor's text become links to the book.
import { describe, expect, it } from "vitest";
import { linkPages } from "@/lib/book-links";

const books = [
  { id: 3, name: "Зорич. Математический анализ.pdf", role: "main" },
  { id: 4, name: "Демидович задачник.pdf", role: "problems" },
];

describe("linkPages", () => {
  it("links page references to the main book by default", () => {
    expect(linkPages("Определение — см. стр. 142.", books)).toBe("Определение — см. [стр. 142](#book-3-142).");
    expect(linkPages("с.12–14", books)).toBe("[с.12–14](#book-3-12)");
  });

  it("uses the book named right before the reference", () => {
    expect(linkPages("Реши из «Демидович задачник», с. 45, № 12.", books)).toBe("Реши из «Демидович задачник», [с. 45](#book-4-45), № 12.");
  });

  it("leaves formulas, code and existing links alone", () => {
    const text = "Формула $с.5$ и `стр. 7` и [стр. 9](https://x.y)";
    expect(linkPages(text, books)).toBe(text);
  });

  it("does nothing without books or inside words", () => {
    expect(linkPages("стр. 5", [])).toBe("стр. 5");
    expect(linkPages("вес.10 кг", books)).toBe("вес.10 кг");
  });
});
