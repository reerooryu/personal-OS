import type { Difficulty, FormulaParams, WeightedSkill } from "./types";

/** Rounds half up, tolerant of floating-point noise (37.5 -> 38, 140.625 -> 141). */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5 + 1e-9);
}

export interface XpInput {
  durationMin: number;
  difficulty: Difficulty | string;
  activityTypeId: string;
}

export interface XpBreakdown {
  baseRate: number;
  durationMin: number;
  effectiveMinutes: number;
  taperThreshold: number;
  taperRate: number;
  difficulty: string;
  difficultyMultiplier: number;
  activityTypeId: string;
  typeMultiplier: number;
  raw: number;
  total: number;
}

/** E(D) = min(D, T) + r * max(0, D - T) */
export function effectiveMinutes(durationMin: number, p: FormulaParams): number {
  const full = Math.min(durationMin, p.taperThreshold);
  const tapered = Math.max(0, durationMin - p.taperThreshold) * p.taperRate;
  return full + tapered;
}

/** XP = round(B * E(D) * Md * Ma) */
export function computeXp(input: XpInput, p: FormulaParams): XpBreakdown {
  const eff = effectiveMinutes(input.durationMin, p);
  const md = p.difficultyMultipliers[input.difficulty as Difficulty] ?? 1;
  const ma = p.typeMultipliers[input.activityTypeId] ?? 1;
  const raw = p.baseRate * eff * md * ma;
  return {
    baseRate: p.baseRate,
    durationMin: input.durationMin,
    effectiveMinutes: eff,
    taperThreshold: p.taperThreshold,
    taperRate: p.taperRate,
    difficulty: String(input.difficulty),
    difficultyMultiplier: md,
    activityTypeId: input.activityTypeId,
    typeMultiplier: ma,
    raw,
    total: Math.max(0, roundHalfUp(raw)),
  };
}

/**
 * Splits an integer total across weighted skills using largest-remainder
 * rounding. Shares are whole numbers that always sum exactly to the total.
 * Ties go to the skill listed first.
 */
export function splitByWeights(total: number, skills: WeightedSkill[]): Map<string, number> {
  const out = new Map<string, number>();
  if (skills.length === 0) return out;
  const weightSum = skills.reduce((s, k) => s + k.weight, 0);
  if (weightSum <= 0) throw new Error("Skill weights must be positive");
  const exact = skills.map((k, i) => {
    const share = (total * k.weight) / weightSum;
    return { id: k.skillId, i, floor: Math.floor(share + 1e-9), rem: share - Math.floor(share + 1e-9) };
  });
  let left = total - exact.reduce((s, e) => s + e.floor, 0);
  const order = [...exact].sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const e of order) {
    if (left <= 0) break;
    e.floor += 1;
    left -= 1;
  }
  for (const e of exact) out.set(e.id, (out.get(e.id) ?? 0) + e.floor);
  return out;
}

/** Equal weights that sum to 100 (largest remainder), for "split equally". */
export function equalWeights(skillIds: string[]): WeightedSkill[] {
  const shares = splitByWeights(
    100,
    skillIds.map((skillId) => ({ skillId, weight: 1 })),
  );
  return skillIds.map((skillId) => ({ skillId, weight: shares.get(skillId) ?? 0 }));
}

export interface Curve {
  base: number;
  exponent: number;
}

/** XP needed to go from level L to L + 1. */
export function xpForNextLevel(level: number, curve: Curve): number {
  return Math.round(curve.base * Math.pow(level, curve.exponent));
}

export interface LevelInfo {
  level: number;
  totalXp: number;
  /** XP earned inside the current level. */
  intoLevel: number;
  /** XP the current level requires in total. */
  levelSize: number;
  /** XP still needed for the next level. */
  toNext: number;
  /** 0-1 progress through the current level. */
  progress: number;
}

/** Everyone starts at level 1 with 0 XP. */
export function levelFromXp(totalXp: number, curve: Curve): LevelInfo {
  let level = 1;
  let floor = 0;
  const xp = Math.max(0, totalXp);
  for (;;) {
    const size = xpForNextLevel(level, curve);
    if (floor + size > xp) {
      const into = xp - floor;
      return { level, totalXp: xp, intoLevel: into, levelSize: size, toNext: size - into, progress: into / size };
    }
    floor += size;
    level += 1;
  }
}

/** Cumulative XP required to reach a level. */
export function xpToReach(level: number, curve: Curve): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpForNextLevel(l, curve);
  return total;
}
