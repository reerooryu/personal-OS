CREATE TABLE `homework` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`skill_id` text NOT NULL,
	`due_at` integer NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	`activity_id` text
);
--> statement-breakpoint
CREATE INDEX `homework_due_idx` ON `homework` (`due_at`);--> statement-breakpoint
CREATE TABLE `tests` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`skill_id` text NOT NULL,
	`start_at` integer NOT NULL,
	`duration_min` integer NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`assessment_id` text,
	`no_result` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tests_start_idx` ON `tests` (`start_at`);