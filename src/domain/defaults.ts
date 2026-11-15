import type { FormulaParams, GradeBand } from "./types";

export const DEFAULT_FORMULA: FormulaParams = {
  baseRate: 1,
  taperThreshold: 90,
  taperRate: 0.5,
  difficultyMultipliers: {
    very_easy: 0.5,
    easy: 0.75,
    normal: 1,
    hard: 1.25,
    very_hard: 1.5,
  },
  typeMultipliers: {
    practice: 1,
    study: 1,
    training: 1,
    lesson: 1,
    project: 1,
    competition: 1.25,
    exam: 1.25,
    light: 0.5,
  },
  characterCurve: { base: 100, exponent: 1.5 },
  skillCurve: { base: 50, exponent: 1.5 },
  questRewardDefaults: { daily: 10, weekly: 50 },
  medalTierXp: { bronze: 500, silver: 1500, gold: 4000 },
};

export const DEFAULT_GRADE_BANDS: GradeBand[] = [
  { grade: "S", min: 90 },
  { grade: "A", min: 80 },
  { grade: "B", min: 65 },
  { grade: "C", min: 50 },
  { grade: "D", min: 35 },
  { grade: "E", min: 20 },
  { grade: "F", min: 0 },
];

export const DEFAULT_TIMEZONE = "Asia/Bangkok";
export const DEFAULT_DAY_BOUNDARY_MINUTES = 4 * 60;
export const MAX_DURATION_MIN = 480;
export const CONFIRM_DURATION_MIN = 240;
