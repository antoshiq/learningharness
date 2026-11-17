CREATE TABLE `drills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_attempt_id` integer NOT NULL,
	`topic_id` integer,
	`node_key` text,
	`mode` text NOT NULL,
	`outcome` text NOT NULL,
	`self_graded` integer DEFAULT false NOT NULL,
	`confidence` integer,
	`hints_used` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `drills_source` ON `drills` (`source_attempt_id`);--> statement-breakpoint
CREATE INDEX `drills_topic` ON `drills` (`topic_id`);--> statement-breakpoint
CREATE INDEX `drills_created` ON `drills` (`created_at`);--> statement-breakpoint
ALTER TABLE `topics` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `topics` ADD `notes_at` integer;