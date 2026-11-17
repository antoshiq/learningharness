CREATE TABLE `explanations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` integer NOT NULL,
	`node_key` text,
	`concept` text NOT NULL,
	`rounds` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `explanations_topic` ON `explanations` (`topic_id`);--> statement-breakpoint
CREATE TABLE `study_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`exam_date` integer NOT NULL,
	`topic_ids` text NOT NULL,
	`created_at` integer NOT NULL
);
