CREATE TABLE `achievement_unlocks` (
	`achievement_id` text PRIMARY KEY NOT NULL,
	`unlocked_at` integer NOT NULL,
	`trigger_ref` text
);
--> statement-breakpoint
CREATE TABLE `achievements` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon` text DEFAULT 'trophy' NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`condition_type` text NOT NULL,
	`params` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `active_timer` (
	`id` integer PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`started_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`client_request_id` text,
	`name` text NOT NULL,
	`notes` text,
	`start_at` integer NOT NULL,
	`duration_min` integer NOT NULL,
	`activity_type_id` text NOT NULL,
	`difficulty` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text,
	`template_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`formula_version_id` integer NOT NULL,
	`is_sample` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activities_client_request_uq` ON `activities` (`client_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `activities_external_uq` ON `activities` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `activities_start_idx` ON `activities` (`start_at`);--> statement-breakpoint
CREATE TABLE `activity_skills` (
	`activity_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`weight` integer NOT NULL,
	PRIMARY KEY(`activity_id`, `skill_id`),
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `activity_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`activity_type_id` text NOT NULL,
	`difficulty` text NOT NULL,
	`duration_min` integer NOT NULL,
	`skills` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE TABLE `activity_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`measurement_type_id` text NOT NULL,
	`assessed_at` integer NOT NULL,
	`raw_value` real,
	`raw_label` text,
	`method` text NOT NULL,
	`notes` text,
	`evidence` text,
	`activity_id` text,
	`not_representative` integer DEFAULT false NOT NULL,
	`not_representative_reason` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_sample` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assessments_skill_idx` ON `assessments` (`skill_id`);--> statement-breakpoint
CREATE TABLE `attributes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text NOT NULL,
	`color` text NOT NULL,
	`sort_order` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `formula_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`params` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`day` text NOT NULL,
	`activity_id` text,
	`title` text,
	`body` text NOT NULL,
	`user_edited` integer DEFAULT false NOT NULL,
	`activity_deleted` integer DEFAULT false NOT NULL,
	`activity_changed_since_edit` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journal_activity_uq` ON `journal_entries` (`activity_id`);--> statement-breakpoint
CREATE INDEX `journal_day_idx` ON `journal_entries` (`day`);--> statement-breakpoint
CREATE TABLE `measurement_types` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`name` text NOT NULL,
	`value_kind` text NOT NULL,
	`unit` text,
	`direction` text NOT NULL,
	`anchor_low` real,
	`anchor_high` real,
	`grade_scale` text,
	`weight` real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `medal_awards` (
	`id` text PRIMARY KEY NOT NULL,
	`medal_id` text NOT NULL,
	`occasion_key` text NOT NULL,
	`occasion` text,
	`awarded_at` integer NOT NULL,
	`origin` text NOT NULL,
	`tier_override` text,
	`xp_override` integer,
	`skills_override` text,
	`evidence` text,
	`notes` text,
	`source` text NOT NULL,
	`is_sample` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medal_awards_occasion_uq` ON `medal_awards` (`medal_id`,`occasion_key`);--> statement-breakpoint
CREATE TABLE `medal_skills` (
	`medal_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`weight` integer NOT NULL,
	PRIMARY KEY(`medal_id`, `skill_id`)
);
--> statement-breakpoint
CREATE TABLE `medals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`tier` text NOT NULL,
	`xp_reward` integer,
	`repeatable` integer DEFAULT false NOT NULL,
	`award_rule` text NOT NULL,
	`linked_quest_id` text,
	`linked_measurement_type_id` text,
	`linked_score_threshold` real,
	`is_sample` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `milestone_checks` (
	`requirement_id` text NOT NULL,
	`period_key` text NOT NULL,
	`checked_at` integer NOT NULL,
	PRIMARY KEY(`requirement_id`, `period_key`)
);
--> statement-breakpoint
CREATE TABLE `notices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`character_name` text NOT NULL,
	`timezone` text NOT NULL,
	`day_boundary_minutes` integer NOT NULL,
	`current_formula_version_id` integer NOT NULL,
	`grade_bands` text NOT NULL,
	`rest_days_per_week` integer NOT NULL,
	`show_sample_data` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quest_completions` (
	`quest_id` text NOT NULL,
	`period_key` text NOT NULL,
	`completed_at` integer NOT NULL,
	`completed_by_ref` text,
	PRIMARY KEY(`quest_id`, `period_key`)
);
--> statement-breakpoint
CREATE TABLE `quest_contributions` (
	`quest_id` text NOT NULL,
	`period_key` text NOT NULL,
	`requirement_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`amount` real NOT NULL,
	`stage_ordinal` integer NOT NULL,
	PRIMARY KEY(`activity_id`, `requirement_id`, `period_key`)
);
--> statement-breakpoint
CREATE INDEX `quest_contrib_quest_idx` ON `quest_contributions` (`quest_id`,`period_key`);--> statement-breakpoint
CREATE TABLE `quest_prerequisites` (
	`quest_id` text NOT NULL,
	`requires_quest_id` text NOT NULL,
	PRIMARY KEY(`quest_id`, `requires_quest_id`)
);
--> statement-breakpoint
CREATE TABLE `quest_requirement_versions` (
	`quest_id` text NOT NULL,
	`version` integer NOT NULL,
	`effective_from` integer NOT NULL,
	PRIMARY KEY(`quest_id`, `version`)
);
--> statement-breakpoint
CREATE TABLE `quest_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`quest_id` text NOT NULL,
	`version` integer NOT NULL,
	`stage_ordinal` integer NOT NULL,
	`stage_title` text,
	`type` text NOT NULL,
	`title` text,
	`target` real NOT NULL,
	`filter` text DEFAULT '{}' NOT NULL,
	`measurement_type_id` text,
	`sub_quest_ids` text
);
--> statement-breakpoint
CREATE TABLE `quest_skills` (
	`quest_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`weight` integer NOT NULL,
	PRIMARY KEY(`quest_id`, `skill_id`)
);
--> statement-breakpoint
CREATE TABLE `quests` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`kind` text NOT NULL,
	`difficulty` text DEFAULT 'normal' NOT NULL,
	`start_at` integer,
	`end_at` integer,
	`reward_xp` integer NOT NULL,
	`status` text NOT NULL,
	`archived_at` integer,
	`parent_quest_id` text,
	`origin` text NOT NULL,
	`is_sample` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `revisions_entity_idx` ON `revisions` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`attribute_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`sort_order` integer NOT NULL,
	`proficiency_model` text DEFAULT 'primary' NOT NULL,
	`primary_measurement_type_id` text,
	`aliases` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`attribute_id`) REFERENCES `attributes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `skills_attribute_idx` ON `skills` (`attribute_id`);--> statement-breakpoint
CREATE TABLE `xp_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`seq` integer NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`formula_version_id` integer,
	`breakdown` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `xp_entries_uq` ON `xp_entries` (`source_type`,`source_id`,`target_type`,`target_id`,`seq`);--> statement-breakpoint
CREATE INDEX `xp_entries_target_idx` ON `xp_entries` (`target_type`,`target_id`);