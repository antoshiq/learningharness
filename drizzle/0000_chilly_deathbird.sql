CREATE TABLE `attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`topic_id` integer,
	`node_key` text,
	`tool_use_id` text NOT NULL,
	`purpose` text NOT NULL,
	`kind` text NOT NULL,
	`question` text NOT NULL,
	`answer` text,
	`outcome` text,
	`auto_graded` integer DEFAULT false NOT NULL,
	`confidence` integer,
	`hints_used` integer DEFAULT 0 NOT NULL,
	`misconception_type` text,
	`misconception` text,
	`mastery_applied` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`answered_at` integer
);
--> statement-breakpoint
CREATE INDEX `attempts_session` ON `attempts` (`session_id`);--> statement-breakpoint
CREATE INDEX `attempts_topic` ON `attempts` (`topic_id`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` integer NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`deps` text NOT NULL,
	`order_idx` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`card` text,
	`due_at` integer,
	`correct_count` integer DEFAULT 0 NOT NULL,
	`wrong_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nodes_topic_key` ON `nodes` (`topic_id`,`key`);--> statement-breakpoint
CREATE INDEX `nodes_due` ON `nodes` (`due_at`);--> statement-breakpoint
CREATE TABLE `parking` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` integer,
	`session_id` integer,
	`text` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` integer,
	`kind` text NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`planned_minutes` integer,
	`messages` text NOT NULL,
	`pending` text,
	`summary` text,
	`started_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `side_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `side_session` ON `side_messages` (`session_id`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'topic' NOT NULL,
	`repo_path` text,
	`repo_map` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer,
	`purpose` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost` real,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_session` ON `usage` (`session_id`);