CREATE TABLE `oral_exams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` integer NOT NULL,
	`turns` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`result` text,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `oral_exams_topic` ON `oral_exams` (`topic_id`);