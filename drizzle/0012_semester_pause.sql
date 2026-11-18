ALTER TABLE `semester_assessments` ADD `homework_id` integer;--> statement-breakpoint
ALTER TABLE `semester_homework` ADD `appeal` text;--> statement-breakpoint
ALTER TABLE `semester_homework` ADD `first_review` text;--> statement-breakpoint
ALTER TABLE `semesters` ADD `paused_at` integer;