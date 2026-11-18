ALTER TABLE `book_pages` ADD `ocr` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `books` ADD `file` text;--> statement-breakpoint
ALTER TABLE `books` ADD `ocr_total` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `books` ADD `ocr_done` integer DEFAULT 0 NOT NULL;