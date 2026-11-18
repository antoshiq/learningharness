CREATE TABLE `book_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` integer NOT NULL,
	`page` integer NOT NULL,
	`text` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_pages_page` ON `book_pages` (`book_id`,`page`);--> statement-breakpoint
CREATE TABLE `book_sections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` integer NOT NULL,
	`idx` integer NOT NULL,
	`level` integer NOT NULL,
	`title` text NOT NULL,
	`page_from` integer NOT NULL,
	`page_to` integer NOT NULL,
	`summary` text
);
--> statement-breakpoint
CREATE INDEX `book_sections_book` ON `book_sections` (`book_id`,`idx`);--> statement-breakpoint
CREATE TABLE `books` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`semester_id` integer,
	`name` text NOT NULL,
	`role` text DEFAULT 'main' NOT NULL,
	`format` text NOT NULL,
	`pages` integer DEFAULT 0 NOT NULL,
	`chars` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'reading' NOT NULL,
	`outline_source` text,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `books_semester` ON `books` (`semester_id`);