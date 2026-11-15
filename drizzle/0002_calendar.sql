CREATE TABLE `calendar_confirmations` (
	`occurrence_key` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`activity_id` text,
	`decided_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`skill_id` text,
	`xp` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendar_rules` (
	`title_key` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`skill_id` text,
	`activity_type_id` text,
	`xp` text DEFAULT 'normal' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `external_events` (
	`uid` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`title_key` text NOT NULL,
	`location` text,
	`category` text,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`all_day` integer NOT NULL,
	`cancelled` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `external_events_start_idx` ON `external_events` (`start_at`);--> statement-breakpoint
CREATE TABLE `school_breaks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`scope` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `timetable_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`kind` text NOT NULL,
	`weekday` integer NOT NULL,
	`week` integer,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`skill_id` text,
	`xp` text NOT NULL
);
