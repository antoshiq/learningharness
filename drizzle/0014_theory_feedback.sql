CREATE TABLE `step_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`topic_id` integer,
	`kind` text NOT NULL,
	`excerpt` text NOT NULL,
	`comment` text,
	`delivered` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `step_feedback_session` ON `step_feedback` (`session_id`);--> statement-breakpoint
CREATE TABLE `theory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` integer NOT NULL,
	`node_key` text NOT NULL,
	`session_id` integer,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `theory_topic_node` ON `theory` (`topic_id`,`node_key`);