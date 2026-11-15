import { z } from "zod";
import { CONFIRM_DURATION_MIN, MAX_DURATION_MIN } from "@/domain/defaults";
import { DIFFICULTIES } from "@/domain/types";

export const weightedSkills = z
  .array(z.object({ skillId: z.string().min(1), weight: z.number().int().min(1).max(100) }))
  .min(1, "Choose at least one skill")
  .refine((s) => s.reduce((a, b) => a + b.weight, 0) === 100, "Skill weights must add up to 100%")
  .refine((s) => new Set(s.map((x) => x.skillId)).size === s.length, "Each skill can appear only once");

export const measuredResult = z.object({
  measurementTypeId: z.string().min(1),
  rawValue: z.number().nullable().optional(),
  rawLabel: z.string().nullable().optional(),
  recordAsAssessment: z.boolean().default(false),
});

export const activityInput = z
  .object({
    name: z.string().trim().min(1, "Give the activity a name").max(120, "Keep the name under 120 characters"),
    notes: z.string().max(5000).nullable().optional(),
    startAt: z.number().int(),
    durationMin: z
      .number()
      .int()
      .min(1, "Duration must be at least 1 minute")
      .max(MAX_DURATION_MIN, `Duration can't be more than ${MAX_DURATION_MIN} minutes`),
    activityTypeId: z.string().min(1),
    difficulty: z.enum(DIFFICULTIES),
    skills: weightedSkills,
    source: z.enum(["manual", "timer", "inbox", "task", "import"]).default("manual"),
    externalId: z.string().nullable().optional(),
    templateId: z.string().nullable().optional(),
    clientRequestId: z.string().min(8).nullable().optional(),
    isSample: z.boolean().default(false),
    confirmLong: z.boolean().default(false),
    results: z.array(measuredResult).default([]),
  })
  .refine((a) => a.durationMin <= CONFIRM_DURATION_MIN || a.confirmLong, {
    message: `Sessions over ${CONFIRM_DURATION_MIN} minutes need confirmation`,
    path: ["confirmLong"],
  });
export type ActivityInput = z.input<typeof activityInput>;

export const assessmentInput = z
  .object({
    skillId: z.string().min(1),
    measurementTypeId: z.string().min(1),
    assessedAt: z.number().int(),
    rawValue: z.number().nullable().optional(),
    rawLabel: z.string().nullable().optional(),
    method: z.enum(["examination", "timed_test", "competition", "formal_assessment", "benchmark", "self_assessment", "school_report"]),
    notes: z.string().max(5000).nullable().optional(),
    evidence: z.string().max(500).nullable().optional(),
    activityId: z.string().nullable().optional(),
    notRepresentative: z.boolean().default(false),
    notRepresentativeReason: z.string().max(500).nullable().optional(),
    source: z.enum(["manual", "import"]).default("manual"),
    isSample: z.boolean().default(false),
    id: z.string().optional(),
  })
  .refine((a) => a.rawValue != null || (a.rawLabel != null && a.rawLabel !== ""), {
    message: "Enter a result",
    path: ["rawValue"],
  });
export type AssessmentInput = z.input<typeof assessmentInput>;

export const requirementInput = z.object({
  id: z.string().optional(),
  stageOrdinal: z.number().int().min(1).default(1),
  stageTitle: z.string().nullable().optional(),
  type: z.enum(["duration", "sessions", "distinct_days", "assessment", "milestone", "subquests"]),
  title: z.string().nullable().optional(),
  target: z.number().positive(),
  filter: z
    .object({
      skillIds: z.array(z.string()).optional(),
      includeSubskills: z.boolean().optional(),
      activityTypeIds: z.array(z.string()).optional(),
      minDifficulty: z.enum(DIFFICULTIES).optional(),
      minSessionMinutes: z.number().int().positive().optional(),
    })
    .default({}),
  measurementTypeId: z.string().nullable().optional(),
  subQuestIds: z.array(z.string()).nullable().optional(),
});

export const questInput = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(5000).nullable().optional(),
  kind: z.enum(["daily", "weekly", "long_term"]),
  difficulty: z.enum(DIFFICULTIES).default("normal"),
  startAt: z.number().int().nullable().optional(),
  endAt: z.number().int().nullable().optional(),
  rewardXp: z.number().int().min(0).max(100_000).optional(),
  status: z.enum(["proposed", "active", "archived"]).default("active"),
  parentQuestId: z.string().nullable().optional(),
  origin: z.enum(["manual", "generated", "sample", "import"]).default("manual"),
  isSample: z.boolean().default(false),
  skills: z.array(z.object({ skillId: z.string(), weight: z.number().int().min(1).max(100) })).default([]),
  prerequisiteIds: z.array(z.string()).default([]),
  requirements: z.array(requirementInput).min(1, "A quest needs at least one requirement"),
});
export type QuestInput = z.input<typeof questInput>;

export const medalAwardInput = z.object({
  id: z.string().optional(),
  medalId: z.string().min(1),
  occasionKey: z.string().min(1),
  occasion: z.string().max(300).nullable().optional(),
  awardedAt: z.number().int(),
  tierOverride: z.enum(["bronze", "silver", "gold"]).nullable().optional(),
  xpOverride: z.number().int().min(0).nullable().optional(),
  skillsOverride: z.array(z.object({ skillId: z.string(), weight: z.number().int().min(1).max(100) })).nullable().optional(),
  evidence: z.string().max(500).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  source: z.enum(["manual", "import"]).default("manual"),
  isSample: z.boolean().default(false),
});
export type MedalAwardInput = z.input<typeof medalAwardInput>;
