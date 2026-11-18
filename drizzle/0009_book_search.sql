-- Full-text search over book pages. External content: the text lives in book_pages, the index follows it by triggers.
CREATE VIRTUAL TABLE `book_pages_fts` USING fts5(`text`, content='book_pages', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `book_pages_ai` AFTER INSERT ON `book_pages` BEGIN
  INSERT INTO `book_pages_fts`(rowid, `text`) VALUES (new.id, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER `book_pages_ad` AFTER DELETE ON `book_pages` BEGIN
  INSERT INTO `book_pages_fts`(`book_pages_fts`, rowid, `text`) VALUES ('delete', old.id, old.text);
END;
--> statement-breakpoint
CREATE TRIGGER `book_pages_au` AFTER UPDATE ON `book_pages` BEGIN
  INSERT INTO `book_pages_fts`(`book_pages_fts`, rowid, `text`) VALUES ('delete', old.id, old.text);
  INSERT INTO `book_pages_fts`(rowid, `text`) VALUES (new.id, new.text);
END;
