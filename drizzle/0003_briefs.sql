CREATE TABLE `briefs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`source` text NOT NULL,
	`depth` integer NOT NULL,
	`text` text NOT NULL,
	`expansions` text NOT NULL,
	`files` text NOT NULL,
	`topic_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `topics` ADD `brief` text;