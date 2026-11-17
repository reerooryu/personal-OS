/**
 * How much revision a test calls for, from the subject's current grade and
 * the trend in its recent test results. Strong and steady: a light plan.
 * Slipping: a fuller one. Pure, so it can be tested without a database.
 */
export type TestKind = "quiz" | "test" | "mock" | "exam";
export type Trend = "slipping" | "steady" | "improving" | "unknown";

/** Minutes and separate days for an ordinary test, by current grade. */
const BASE: Record<string, [number, number]> = {
  S: [60, 2],
  A: [90, 2],
  B: [120, 3],
  C: [150, 3],
  D: [180, 4],
  E: [180, 4],
  F: [180, 4],
};
const UNGRADED: [number, number] = [120, 3];
const KIND_FACTOR: Record<TestKind, number> = { quiz: 0.5, test: 1, mock: 1.5, exam: 2 };
const KIND_NAME: Record<TestKind, string> = { quiz: "quiz", test: "test", mock: "mock exam", exam: "exam" };

/** A drop of this many points from the previous results counts as slipping. */
export const SLIP_POINTS = 8;
/** Scoring this far below the current grade's level also counts as slipping. */
const BELOW_GRADE_POINTS = 15;
const MAX_MINUTES_PER_DAY = 90;

export interface RevisionInput {
  subject: string;
  kind: TestKind;
  /** Current proficiency grade and score (from the GCSE reporting grade for school subjects). */
  grade: string | null;
  score: number | null;
  /** Recent test percentages for the subject, oldest first, unrepresentative ones left out. */
  recentTests: number[];
  /** Days left to revise, today included. */
  daysAvailable: number;
}

export interface RevisionPlan {
  minutes: number;
  days: number;
  trend: Trend;
  /** One plain sentence explaining the size of the plan. */
  reason: string;
}

export function trendOf(recentTests: number[], score: number | null): { trend: Trend; latest: number | null; before: number | null } {
  if (!recentTests.length) return { trend: "unknown", latest: null, before: null };
  const latest = recentTests.at(-1)!;
  const prev = recentTests.slice(-3, -1);
  const before = prev.length ? prev.reduce((s, x) => s + x, 0) / prev.length : null;
  if (before !== null && latest <= before - SLIP_POINTS) return { trend: "slipping", latest, before };
  if (score !== null && latest <= score - BELOW_GRADE_POINTS) return { trend: "slipping", latest, before };
  if (before !== null && latest >= before + SLIP_POINTS) return { trend: "improving", latest, before };
  return { trend: before === null ? "unknown" : "steady", latest, before };
}

const round15 = (m: number) => Math.max(15, Math.round(m / 15) * 15);

export function planRevision(x: RevisionInput): RevisionPlan {
  const [baseMin, baseDays] = (x.grade && BASE[x.grade]) || UNGRADED;
  const { trend, latest, before } = trendOf(x.recentTests, x.score);
  let minutes = baseMin * KIND_FACTOR[x.kind];
  let days = baseDays + (x.kind === "mock" || x.kind === "exam" ? 1 : x.kind === "quiz" ? -1 : 0);
  if (trend === "slipping") {
    minutes *= 1.5;
    days += 1;
  }
  const available = Math.max(1, x.daysAvailable);
  days = Math.max(1, Math.min(days, available));
  minutes = round15(Math.min(minutes, available * MAX_MINUTES_PER_DAY));

  const pct = (n: number) => `${Math.round(n)}%`;
  const where = x.grade ? `${x.subject} is at ${x.grade}` : `There's no ${x.subject} grade yet`;
  const how =
    trend === "slipping"
      ? latest !== null && before !== null && latest <= before - SLIP_POINTS
        ? `but recent tests are slipping (${pct(before)} → ${pct(latest)})`
        : `but the last test (${pct(latest!)}) was well below that`
      : trend === "improving"
        ? `and recent tests are improving (${pct(before!)} → ${pct(latest!)})`
        : trend === "steady"
          ? "and recent tests are steady"
          : "";
  const size = trend === "slipping" ? "a fuller plan" : minutes <= 60 ? "a light plan" : "a normal plan";
  const squeeze = days < baseDays && available < baseDays ? ` There ${available === 1 ? "is 1 day" : `are ${available} days`} left, so it's squeezed.` : "";
  const reason = `${where}${how ? ` ${how}` : ""}, so ${size} for this ${KIND_NAME[x.kind]}: ${minutes} minutes over ${days} day${days === 1 ? "" : "s"}.${squeeze}`;
  return { minutes, days, trend, reason };
}
