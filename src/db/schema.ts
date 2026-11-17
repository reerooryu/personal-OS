/**
 * ASCEND database schema.
 *
 * Tables are either SOURCE (entered by the user) or DERIVED (computed by the
 * engine from sources). Derived tables must always be rebuildable from sources
 * alone. See ARCHITECTURE.md.
 */
import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

const bool = (name: string) => integer(name, { mode: "boolean" });
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
const createdAt = () =>
  integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

// ---------------------------------------------------------------- SOURCE ---

export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey(),
  characterName: text("character_name").notNull(),
  timezone: text("timezone").notNull(),
  dayBoundaryMinutes: integer("day_boundary_minutes").notNull(),
  currentFormulaVersionId: integer("current_formula_version_id").notNull(),
  gradeBands: json<{ grade: string; min: number }[]>("grade_bands").notNull(),
  restDaysPerWeek: integer("rest_days_per_week").notNull(),
  showSampleData: bool("show_sample_data").notNull(),
});

/** Small app-wide settings (import folder, usage log switch). Key/value so new settings need no migration. */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: json<unknown>("value").notNull(),
});

export const formulaVersions = sqliteTable("formula_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  params: json<import("@/domain/types").FormulaParams>("params").notNull(),
  createdAt: createdAt(),
});

export const attributes = sqliteTable("attributes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon").notNull(),
  color: text("color").notNull(),
  sortOrder: integer("sort_order").notNull(),
  archived: bool("archived").notNull().default(false),
});

export const skills = sqliteTable(
  "skills",
  {
    id: text("id").primaryKey(),
    attributeId: text("attribute_id")
      .notNull()
      .references(() => attributes.id),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["skill", "trait"] }).notNull(),
    archived: bool("archived").notNull().default(false),
    sortOrder: integer("sort_order").notNull(),
    proficiencyModel: text("proficiency_model", { enum: ["primary", "weighted"] })
      .notNull()
      .default("primary"),
    primaryMeasurementTypeId: text("primary_measurement_type_id"),
    aliases: json<string[]>("aliases").notNull().default([]),
  },
  (t) => [index("skills_attribute_idx").on(t.attributeId)],
);

export const activityTypes = sqliteTable("activity_types", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const activityTemplates = sqliteTable("activity_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  aliases: json<string[]>("aliases").notNull().default([]),
  activityTypeId: text("activity_type_id").notNull(),
  difficulty: text("difficulty").notNull(),
  durationMin: integer("duration_min").notNull(),
  skills: json<{ skillId: string; weight: number }[]>("skills").notNull(),
  pinned: bool("pinned").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  lastUsedAt: integer("last_used_at"),
});

export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    clientRequestId: text("client_request_id"),
    name: text("name").notNull(),
    notes: text("notes"),
    startAt: integer("start_at").notNull(),
    durationMin: integer("duration_min").notNull(),
    activityTypeId: text("activity_type_id").notNull(),
    difficulty: text("difficulty").notNull(),
    source: text("source", { enum: ["manual", "timer", "inbox", "task", "import"] }).notNull(),
    externalId: text("external_id"),
    templateId: text("template_id"),
    revision: integer("revision").notNull().default(1),
    formulaVersionId: integer("formula_version_id").notNull(),
    isSample: bool("is_sample").notNull().default(false),
    deletedAt: integer("deleted_at"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at"),
  },
  (t) => [
    uniqueIndex("activities_client_request_uq").on(t.clientRequestId),
    uniqueIndex("activities_external_uq").on(t.source, t.externalId),
    index("activities_start_idx").on(t.startAt),
  ],
);

export const activitySkills = sqliteTable(
  "activity_skills",
  {
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id),
    skillId: text("skill_id").notNull(),
    weight: integer("weight").notNull(),
  },
  (t) => [primaryKey({ columns: [t.activityId, t.skillId] })],
);

/** Snapshots of earlier versions of edited activities and assessments. */
export const revisions = sqliteTable(
  "revisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityType: text("entity_type", { enum: ["activity", "assessment"] }).notNull(),
    entityId: text("entity_id").notNull(),
    revision: integer("revision").notNull(),
    snapshot: json<Record<string, unknown>>("snapshot").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("revisions_entity_idx").on(t.entityType, t.entityId)],
);

export const measurementTypes = sqliteTable("measurement_types", {
  id: text("id").primaryKey(),
  skillId: text("skill_id").notNull(),
  name: text("name").notNull(),
  valueKind: text("value_kind", { enum: ["number", "time", "percent", "grade"] }).notNull(),
  unit: text("unit"),
  direction: text("direction", { enum: ["higher", "lower"] }).notNull(),
  anchorLow: real("anchor_low"),
  anchorHigh: real("anchor_high"),
  gradeScale: json<{ label: string; score: number }[]>("grade_scale"),
  weight: real("weight").notNull().default(1),
});

export const assessments = sqliteTable(
  "assessments",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id").notNull(),
    measurementTypeId: text("measurement_type_id").notNull(),
    assessedAt: integer("assessed_at").notNull(),
    rawValue: real("raw_value"),
    rawLabel: text("raw_label"),
    method: text("method").notNull(),
    notes: text("notes"),
    evidence: text("evidence"),
    activityId: text("activity_id"),
    notRepresentative: bool("not_representative").notNull().default(false),
    notRepresentativeReason: text("not_representative_reason"),
    source: text("source", { enum: ["manual", "import"] }).notNull().default("manual"),
    revision: integer("revision").notNull().default(1),
    isSample: bool("is_sample").notNull().default(false),
    deletedAt: integer("deleted_at"),
    createdAt: createdAt(),
  },
  (t) => [index("assessments_skill_idx").on(t.skillId)],
);

export const quests = sqliteTable("quests", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  kind: text("kind", { enum: ["daily", "weekly", "long_term"] }).notNull(),
  difficulty: text("difficulty").notNull().default("normal"),
  startAt: integer("start_at"),
  endAt: integer("end_at"),
  rewardXp: integer("reward_xp").notNull(),
  status: text("status", { enum: ["proposed", "active", "archived"] }).notNull(),
  /** Archived quests keep their history but stop counting from this time. */
  archivedAt: integer("archived_at"),
  parentQuestId: text("parent_quest_id"),
  origin: text("origin", { enum: ["manual", "generated", "sample", "import"] }).notNull(),
  isSample: bool("is_sample").notNull().default(false),
  createdAt: createdAt(),
});

export const questSkills = sqliteTable(
  "quest_skills",
  {
    questId: text("quest_id").notNull(),
    skillId: text("skill_id").notNull(),
    weight: integer("weight").notNull(),
  },
  (t) => [primaryKey({ columns: [t.questId, t.skillId] })],
);

/** Requirement sets are versioned. A version applies to periods starting at or after effectiveFrom. */
export const questRequirementVersions = sqliteTable(
  "quest_requirement_versions",
  {
    questId: text("quest_id").notNull(),
    version: integer("version").notNull(),
    effectiveFrom: integer("effective_from").notNull(),
  },
  (t) => [primaryKey({ columns: [t.questId, t.version] })],
);

export const questRequirements = sqliteTable("quest_requirements", {
  id: text("id").primaryKey(),
  questId: text("quest_id").notNull(),
  version: integer("version").notNull(),
  stageOrdinal: integer("stage_ordinal").notNull(),
  stageTitle: text("stage_title"),
  type: text("type", {
    enum: ["duration", "sessions", "distinct_days", "assessment", "milestone", "subquests"],
  }).notNull(),
  title: text("title"),
  target: real("target").notNull(),
  filter: json<import("@/domain/types").RequirementFilter>("filter").notNull().default({}),
  measurementTypeId: text("measurement_type_id"),
  subQuestIds: json<string[]>("sub_quest_ids"),
});

export const questPrerequisites = sqliteTable(
  "quest_prerequisites",
  {
    questId: text("quest_id").notNull(),
    requiresQuestId: text("requires_quest_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.questId, t.requiresQuestId] })],
);

export const milestoneChecks = sqliteTable(
  "milestone_checks",
  {
    requirementId: text("requirement_id").notNull(),
    periodKey: text("period_key").notNull(),
    checkedAt: integer("checked_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.requirementId, t.periodKey] })],
);

export const medals = sqliteTable("medals", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  tier: text("tier", { enum: ["bronze", "silver", "gold"] }).notNull(),
  xpReward: integer("xp_reward"),
  repeatable: bool("repeatable").notNull().default(false),
  awardRule: text("award_rule", { enum: ["manual", "quest", "assessment"] }).notNull(),
  linkedQuestId: text("linked_quest_id"),
  linkedMeasurementTypeId: text("linked_measurement_type_id"),
  linkedScoreThreshold: real("linked_score_threshold"),
  isSample: bool("is_sample").notNull().default(false),
});

export const medalSkills = sqliteTable(
  "medal_skills",
  {
    medalId: text("medal_id").notNull(),
    skillId: text("skill_id").notNull(),
    weight: integer("weight").notNull(),
  },
  (t) => [primaryKey({ columns: [t.medalId, t.skillId] })],
);

/**
 * Medal awards. Manual awards are sources. Linked awards (origin = "linked")
 * are derived from quest completions or assessments.
 */
export const medalAwards = sqliteTable(
  "medal_awards",
  {
    id: text("id").primaryKey(),
    medalId: text("medal_id").notNull(),
    occasionKey: text("occasion_key").notNull(),
    occasion: text("occasion"),
    awardedAt: integer("awarded_at").notNull(),
    origin: text("origin", { enum: ["manual", "linked"] }).notNull(),
    tierOverride: text("tier_override", { enum: ["bronze", "silver", "gold"] }),
    xpOverride: integer("xp_override"),
    skillsOverride: json<{ skillId: string; weight: number }[]>("skills_override"),
    evidence: text("evidence"),
    notes: text("notes"),
    source: text("source", { enum: ["manual", "import", "engine"] }).notNull(),
    isSample: bool("is_sample").notNull().default(false),
  },
  (t) => [uniqueIndex("medal_awards_occasion_uq").on(t.medalId, t.occasionKey)],
);

export const achievements = sqliteTable("achievements", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon").notNull().default("trophy"),
  hidden: bool("hidden").notNull().default(false),
  conditionType: text("condition_type").notNull(),
  params: json<Record<string, unknown>>("params").notNull(),
});

export const journalEntries = sqliteTable(
  "journal_entries",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["auto", "manual"] }).notNull(),
    day: text("day").notNull(),
    activityId: text("activity_id"),
    title: text("title"),
    body: text("body").notNull(),
    userEdited: bool("user_edited").notNull().default(false),
    activityDeleted: bool("activity_deleted").notNull().default(false),
    activityChangedSinceEdit: bool("activity_changed_since_edit").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: integer("updated_at"),
  },
  (t) => [uniqueIndex("journal_activity_uq").on(t.activityId), index("journal_day_idx").on(t.day)],
);

export const activeTimer = sqliteTable("active_timer", {
  id: integer("id").primaryKey(),
  templateId: text("template_id").notNull(),
  startedAt: integer("started_at").notNull(),
});

// --------------------------------------------------------------- DERIVED ---

/** Append-only XP ledger. Corrections are new rows, never updates or deletes. */
export const xpEntries = sqliteTable(
  "xp_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceType: text("source_type", {
      enum: ["activity", "quest_completion", "medal_award"],
    }).notNull(),
    sourceId: text("source_id").notNull(),
    targetType: text("target_type", { enum: ["character", "skill"] }).notNull(),
    targetId: text("target_id").notNull(),
    seq: integer("seq").notNull(),
    amount: integer("amount").notNull(),
    reason: text("reason", { enum: ["award", "correction"] }).notNull(),
    formulaVersionId: integer("formula_version_id"),
    breakdown: json<Record<string, unknown>>("breakdown"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("xp_entries_uq").on(t.sourceType, t.sourceId, t.targetType, t.targetId, t.seq),
    index("xp_entries_target_idx").on(t.targetType, t.targetId),
  ],
);

export const questContributions = sqliteTable(
  "quest_contributions",
  {
    questId: text("quest_id").notNull(),
    periodKey: text("period_key").notNull(),
    requirementId: text("requirement_id").notNull(),
    activityId: text("activity_id").notNull(),
    amount: real("amount").notNull(),
    stageOrdinal: integer("stage_ordinal").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.activityId, t.requirementId, t.periodKey] }),
    index("quest_contrib_quest_idx").on(t.questId, t.periodKey),
  ],
);

export const questCompletions = sqliteTable(
  "quest_completions",
  {
    questId: text("quest_id").notNull(),
    periodKey: text("period_key").notNull(),
    completedAt: integer("completed_at").notNull(),
    completedByRef: text("completed_by_ref"),
  },
  (t) => [primaryKey({ columns: [t.questId, t.periodKey] })],
);

export const achievementUnlocks = sqliteTable("achievement_unlocks", {
  achievementId: text("achievement_id").primaryKey(),
  unlockedAt: integer("unlocked_at").notNull(),
  triggerRef: text("trigger_ref"),
});

export const notices = sqliteTable("notices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  createdAt: createdAt(),
  readAt: integer("read_at"),
});

// --------------------------------------------------------------- IMPORTS ---

/**
 * What to do with a workout type from Apple Health ("Tennis", "Pool Swim").
 * Created automatically for obvious types, or when Ryu picks "always" in review.
 */
export const importRules = sqliteTable("import_rules", {
  workoutType: text("workout_type").primaryKey(),
  action: text("action", { enum: ["log", "ignore"] }).notNull(),
  skillId: text("skill_id"),
  activityTypeId: text("activity_type_id"),
  createdAt: createdAt(),
});

/**
 * One workout seen in an export file. Kept even when ignored, so it is never
 * offered twice. Pending items wait in the review list.
 */
export const importItems = sqliteTable(
  "import_items",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    workoutType: text("workout_type").notNull(),
    startAt: integer("start_at").notNull(),
    durationMin: integer("duration_min").notNull(),
    details: json<WorkoutDetails>("details").notNull(),
    status: text("status", { enum: ["pending", "imported", "matched", "ignored"] }).notNull(),
    activityId: text("activity_id"),
    fileName: text("file_name"),
    createdAt: createdAt(),
    decidedAt: integer("decided_at"),
  },
  (t) => [uniqueIndex("import_items_uq").on(t.provider, t.externalId), index("import_items_status_idx").on(t.status)],
);

export interface WorkoutDetails {
  distanceKm?: number;
  kcal?: number;
  avgHr?: number;
  maxHr?: number;
  location?: string;
  sourceName?: string;
}

// ----------------------------------------------------------------- USAGE ---

/**
 * The usage log: what was opened and clicked, how long logging took, forms
 * given up on, errors. Never what was typed. Not part of exports or the engine.
 */
export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: integer("at").notNull(),
    sessionId: text("session_id").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    path: text("path"),
    ms: integer("ms"),
    meta: json<Record<string, string | number | boolean>>("meta"),
  },
  (t) => [index("usage_events_at_idx").on(t.at)],
);

// -------------------------------------------------------------- CALENDAR ---

/**
 * The school timetable and regular tutoring: one row per slot in the two-week
 * rotation. `week` is 1 or 2, or null for every week. Kept in
 * private/timetable.json on the Mac (never in git) and imported from there.
 */
export const timetableSlots = sqliteTable("timetable_slots", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  location: text("location"),
  /** lesson: shown, no XP. tutoring: confirm to log. duty: confirm, small XP. */
  kind: text("kind", { enum: ["lesson", "tutoring", "duty"] }).notNull(),
  /** 1 = Monday ... 7 = Sunday */
  weekday: integer("weekday").notNull(),
  week: integer("week"),
  startMin: integer("start_min").notNull(),
  endMin: integer("end_min").notNull(),
  skillId: text("skill_id"),
  xp: text("xp", { enum: ["none", "normal", "small"] }).notNull(),
});

/** One-off events (an exam, a trip). */
export const calendarEvents = sqliteTable("calendar_events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  location: text("location"),
  startAt: integer("start_at").notNull(),
  endAt: integer("end_at").notNull(),
  skillId: text("skill_id"),
  xp: text("xp", { enum: ["none", "normal", "small"] }).notNull(),
});

/** Holidays and closures. "school" pauses lessons and duties; "everything" pauses tutoring too. */
export const schoolBreaks = sqliteTable("school_breaks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  scope: text("scope", { enum: ["school", "everything"] }).notNull(),
});

/** What a school feed event counts as, by title ("vex robotics competition" → Robotics). */
export const calendarRules = sqliteTable("calendar_rules", {
  titleKey: text("title_key").primaryKey(),
  action: text("action", { enum: ["log", "ignore"] }).notNull(),
  skillId: text("skill_id"),
  activityTypeId: text("activity_type_id"),
  xp: text("xp", { enum: ["normal", "small"] }).notNull().default("normal"),
});

/** "Did you go?" answers, one per occurrence. */
export const calendarConfirmations = sqliteTable("calendar_confirmations", {
  occurrenceKey: text("occurrence_key").primaryKey(),
  status: text("status", { enum: ["done", "skipped"] }).notNull(),
  activityId: text("activity_id"),
  decidedAt: integer("decided_at").notNull(),
});

/** Cache of the school's SOCS feed. Replaced on every successful fetch. */
export const externalEvents = sqliteTable(
  "external_events",
  {
    uid: text("uid").primaryKey(),
    title: text("title").notNull(),
    titleKey: text("title_key").notNull(),
    location: text("location"),
    category: text("category"),
    startAt: integer("start_at").notNull(),
    endAt: integer("end_at").notNull(),
    allDay: bool("all_day").notNull(),
    cancelled: bool("cancelled").notNull(),
  },
  (t) => [index("external_events_start_idx").on(t.startAt)],
);

// -------------------------------------------------------- HOMEWORK, TESTS ---

/** Homework. Done on or before the due time counts toward Time Management. */
export const homework = sqliteTable(
  "homework",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    skillId: text("skill_id").notNull(),
    dueAt: integer("due_at").notNull(),
    description: text("description"),
    createdAt: createdAt(),
    completedAt: integer("completed_at"),
    /** The study session logged when it was ticked off, if any. */
    activityId: text("activity_id"),
  },
  (t) => [index("homework_due_idx").on(t.dueAt)],
);

/** Tests and exams. The result, once entered, is an assessment. */
export const tests = sqliteTable(
  "tests",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    kind: text("kind", { enum: ["quiz", "test", "mock", "exam"] }).notNull(),
    skillId: text("skill_id").notNull(),
    startAt: integer("start_at").notNull(),
    durationMin: integer("duration_min").notNull(),
    notes: text("notes"),
    createdAt: createdAt(),
    assessmentId: text("assessment_id"),
    /** Set when Ryu says there will be no result to enter. */
    noResult: bool("no_result").notNull().default(false),
    /** The revision quest generated for this test, if any. */
    revisionQuestId: text("revision_quest_id"),
  },
  (t) => [index("tests_start_idx").on(t.startAt)],
);
