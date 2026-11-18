CREATE TABLE `semester_assessments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`semester_id` integer NOT NULL,
	`module_id` integer,
	`kind` text NOT NULL,
	`score` real NOT NULL,
	`passed` integer NOT NULL,
	`details` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `semester_assessments_semester` ON `semester_assessments` (`semester_id`);--> statement-breakpoint
CREATE TABLE `semester_homework` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`semester_id` integer NOT NULL,
	`week` integer NOT NULL,
	`module_ids` text NOT NULL,
	`title` text NOT NULL,
	`task` text NOT NULL,
	`rubric` text NOT NULL,
	`answer` text,
	`review` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`graded_at` integer
);
--> statement-breakpoint
CREATE INDEX `semester_homework_semester` ON `semester_homework` (`semester_id`);--> statement-breakpoint
CREATE TABLE `semester_modules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`semester_id` integer NOT NULL,
	`idx` integer NOT NULL,
	`part` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`hours` real DEFAULT 4 NOT NULL,
	`kind` text DEFAULT 'regular' NOT NULL,
	`sections` text NOT NULL,
	`topic_id` integer,
	`guide` text,
	`prepared_at` integer,
	`credit` text,
	`passed_at` integer
);
--> statement-breakpoint
CREATE INDEX `semester_modules_semester` ON `semester_modules` (`semester_id`,`idx`);--> statement-breakpoint
CREATE TABLE `semesters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`request` text DEFAULT '' NOT NULL,
	`level` text NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`weeks` integer NOT NULL,
	`hours_per_week` integer NOT NULL,
	`start_date` integer NOT NULL,
	`status` text NOT NULL,
	`step` text,
	`error` text,
	`estimate_hours` real,
	`prereqs` text NOT NULL,
	`notes` text NOT NULL,
	`recommended` text NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
ALTER TABLE `books` ADD `bookmarks` text;--> statement-breakpoint
ALTER TABLE `topics` ADD `semester_module_id` integer;