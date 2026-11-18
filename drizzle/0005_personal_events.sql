ALTER TABLE `calendar_events` ADD `origin` text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `kind` text DEFAULT 'event' NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `all_day` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `group_id` text;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `activity_type_id` text;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `notes` text;