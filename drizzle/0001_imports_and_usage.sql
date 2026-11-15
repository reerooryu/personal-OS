CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_items` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`workout_type` text NOT NULL,
	`start_at` integer NOT NULL,
	`duration_min` integer NOT NULL,
	`details` text NOT NULL,
	`status` text NOT NULL,
	`activity_id` text,
	`file_name` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_items_uq` ON `import_items` (`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `import_items_status_idx` ON `import_items` (`status`);--> statement-breakpoint
CREATE TABLE `import_rules` (
	`workout_type` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`skill_id` text,
	`activity_type_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`path` text,
	`ms` integer,
	`meta` text
);
--> statement-breakpoint
CREATE INDEX `usage_events_at_idx` ON `usage_events` (`at`);