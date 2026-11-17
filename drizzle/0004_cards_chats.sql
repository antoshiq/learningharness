CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` integer NOT NULL,
	`brief_id` integer,
	`node_key` text,
	`origin` text NOT NULL,
	`question` text NOT NULL,
	`card` text,
	`due_at` integer NOT NULL,
	`last_outcome` text,
	`reps` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cards_topic` ON `cards` (`topic_id`);--> statement-breakpoint
CREATE INDEX `cards_due` ON `cards` (`due_at`);--> statement-breakpoint
CREATE TABLE `repo_chats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo` text NOT NULL,
	`url` text,
	`title` text NOT NULL,
	`messages` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `briefs` ADD `commit` text;--> statement-breakpoint
ALTER TABLE `drills` ADD `card_id` integer;