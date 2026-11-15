/** Shared domain types. The domain layer is pure: no database, no React, no clock. */

export const DIFFICULTIES = ["very_easy", "easy", "normal", "hard", "very_hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  very_easy: "Very easy",
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
  very_hard: "Very hard",
};

export function difficultyRank(d: string): number {
  const i = DIFFICULTIES.indexOf(d as Difficulty);
  return i < 0 ? 3 : i + 1;
}

export interface FormulaParams {
  /** XP per effective minute. */
  baseRate: number;
  /** Minutes at full rate before the taper starts. */
  taperThreshold: number;
  /** Rate applied to minutes after the threshold. */
  taperRate: number;
  difficultyMultipliers: Record<Difficulty, number>;
  /** Multiplier per activity type id. Unknown types use 1. */
  typeMultipliers: Record<string, number>;
  characterCurve: { base: number; exponent: number };
  skillCurve: { base: number; exponent: number };
  questRewardDefaults: { daily: number; weekly: number };
  medalTierXp: { bronze: number; silver: number; gold: number };
}

export interface WeightedSkill {
  skillId: string;
  /** Percentage, 0-100. Weights on one record sum to 100. */
  weight: number;
}

export interface RequirementFilter {
  skillIds?: string[];
  includeSubskills?: boolean;
  activityTypeIds?: string[];
  minDifficulty?: Difficulty;
  minSessionMinutes?: number;
}

export type MedalTier = "bronze" | "silver" | "gold";

export interface GradeBand {
  grade: string;
  min: number;
}
