import type { GradeBand } from "./types";

export interface MeasurementTypeDef {
  id: string;
  valueKind: "number" | "time" | "percent" | "grade";
  direction: "higher" | "lower";
  anchorLow: number | null;
  anchorHigh: number | null;
  gradeScale: { label: string; score: number }[] | null;
  weight: number;
}

export interface AssessmentFact {
  id: string;
  measurementTypeId: string;
  assessedAt: number;
  rawValue: number | null;
  rawLabel: string | null;
  notRepresentative: boolean;
  /** Tie-breaker for two assessments at the same instant. */
  createdAt: number;
}

const clamp = (x: number) => Math.min(100, Math.max(0, x));

/**
 * Maps a raw result to a 0-100 score. anchorLow is the raw value that scores 0
 * and anchorHigh the value that scores 100, so "lower is better" measurements
 * simply have anchorLow > anchorHigh (60 s -> 0, 25 s -> 100).
 * Returns null when the result can't be scored.
 */
export function normalize(mt: MeasurementTypeDef, rawValue: number | null, rawLabel: string | null): number | null {
  if (mt.valueKind === "grade") {
    const hit = mt.gradeScale?.find((g) => g.label === rawLabel);
    return hit ? clamp(hit.score) : null;
  }
  if (rawValue === null || mt.anchorLow === null || mt.anchorHigh === null) return null;
  if (mt.anchorHigh === mt.anchorLow) return null;
  return clamp(((rawValue - mt.anchorLow) / (mt.anchorHigh - mt.anchorLow)) * 100);
}

export interface ProficiencyResult {
  /** Rounded 0-100 score, or null when not assessed. */
  score: number | null;
  exact: number | null;
  latestAt: number | null;
  /** The assessment ids the score is based on. */
  basis: string[];
}

function latestPerType(assessments: AssessmentFact[]): Map<string, AssessmentFact> {
  const latest = new Map<string, AssessmentFact>();
  for (const a of assessments) {
    if (a.notRepresentative) continue;
    const cur = latest.get(a.measurementTypeId);
    if (!cur || a.assessedAt > cur.assessedAt || (a.assessedAt === cur.assessedAt && a.createdAt > cur.createdAt)) {
      latest.set(a.measurementTypeId, a);
    }
  }
  return latest;
}

/**
 * Primary model: the latest score of one chosen measurement type.
 * Weighted model: weighted mean of the latest score of each type with weight > 0.
 * Assessments marked "not representative" never count.
 */
export function proficiency(
  model: "primary" | "weighted",
  primaryTypeId: string | null,
  types: MeasurementTypeDef[],
  assessments: AssessmentFact[],
): ProficiencyResult {
  const byId = new Map(types.map((t) => [t.id, t]));
  const latest = latestPerType(assessments);
  const none: ProficiencyResult = { score: null, exact: null, latestAt: null, basis: [] };

  if (model === "primary") {
    if (!primaryTypeId) return none;
    const a = latest.get(primaryTypeId);
    const mt = byId.get(primaryTypeId);
    if (!a || !mt) return none;
    const s = normalize(mt, a.rawValue, a.rawLabel);
    if (s === null) return none;
    return { score: Math.round(s), exact: s, latestAt: a.assessedAt, basis: [a.id] };
  }

  let sum = 0;
  let wsum = 0;
  let latestAt = 0;
  const basis: string[] = [];
  for (const [typeId, a] of latest) {
    const mt = byId.get(typeId);
    if (!mt || mt.weight <= 0) continue;
    const s = normalize(mt, a.rawValue, a.rawLabel);
    if (s === null) continue;
    sum += s * mt.weight;
    wsum += mt.weight;
    latestAt = Math.max(latestAt, a.assessedAt);
    basis.push(a.id);
  }
  if (wsum === 0) return none;
  const exact = sum / wsum;
  return { score: Math.round(exact), exact, latestAt, basis };
}

/** Letter grade for a 0-100 score. Bands are matched from the highest minimum down. */
export function gradeFor(score: number | null, bands: GradeBand[]): string | null {
  if (score === null) return null;
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  for (const b of sorted) if (score >= b.min) return b.grade;
  return sorted.at(-1)?.grade ?? null;
}

/** Progress (0-1) from the current grade's floor toward the next grade. */
export function gradeProgress(score: number | null, bands: GradeBand[]): { next: string | null; progress: number } {
  if (score === null) return { next: null, progress: 0 };
  const asc = [...bands].sort((a, b) => a.min - b.min);
  const idx = asc.findLastIndex((b) => score >= b.min);
  const cur = asc[idx];
  const nxt = asc[idx + 1];
  if (!cur || !nxt) return { next: null, progress: 1 };
  return { next: nxt.grade, progress: (score - cur.min) / (nxt.min - cur.min) };
}

export const STALE_AFTER_MS = 365 * 86_400_000;
