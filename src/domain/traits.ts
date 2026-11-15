/**
 * Traits are computed from behavior, never logged: Consistency, Discipline and
 * Time Management. Scores are 0-100 over a rolling window, or null when there
 * isn't enough data to say anything fair.
 */
import { addDays, daysBetween, isoWeekOfDay } from "./time";

export const TRAIT_WINDOW_DAYS = 28;
export const ACTIVE_DAY_MINUTES = 10;

/**
 * Walks days in order and marks each as active, rest (forgiven) or missed.
 * Each ISO week forgives up to `restDaysPerWeek` missed days.
 */
export function classifyDays(
  activeDays: Set<string>,
  fromDay: string,
  toDay: string,
  restDaysPerWeek: number,
): Map<string, "active" | "rest" | "missed"> {
  const out = new Map<string, "active" | "rest" | "missed">();
  const restUsed = new Map<string, number>();
  for (let d = fromDay; daysBetween(d, toDay) >= 0; d = addDays(d, 1)) {
    if (activeDays.has(d)) {
      out.set(d, "active");
      continue;
    }
    const wk = isoWeekOfDay(d);
    const used = restUsed.get(wk) ?? 0;
    if (used < restDaysPerWeek) {
      restUsed.set(wk, used + 1);
      out.set(d, "rest");
    } else {
      out.set(d, "missed");
    }
  }
  return out;
}

/**
 * Consistency: share of days in the window with at least 10 minutes logged,
 * counting forgiven rest days as kept. Today only counts once it's active,
 * so an unfinished day never lowers the score.
 */
export function consistencyScore(
  minutesByDay: Map<string, number>,
  today: string,
  restDaysPerWeek: number,
): number | null {
  const active = new Set([...minutesByDay].filter(([, m]) => m >= ACTIVE_DAY_MINUTES).map(([d]) => d));
  if (active.size === 0) return null;
  const first = [...active].sort()[0]!;
  const end = active.has(today) ? today : addDays(today, -1);
  const available = daysBetween(first, end) + 1;
  if (available < 7) return null;
  const span = Math.min(TRAIT_WINDOW_DAYS, available);
  const start = addDays(end, -(span - 1));
  const days = classifyDays(active, start, end, restDaysPerWeek);
  let kept = 0;
  for (const v of days.values()) if (v !== "missed") kept++;
  return Math.round((kept / span) * 100);
}

/** Discipline: share of daily quest instances completed in the window. */
export function disciplineScore(instances: { completed: boolean }[]): number | null {
  if (instances.length < 7) return null;
  return Math.round((instances.filter((i) => i.completed).length / instances.length) * 100);
}

/** Time Management: share of tasks with a deadline that were done on or before it. */
export function timeManagementScore(tasks: { onTime: boolean }[]): number | null {
  if (tasks.length < 3) return null;
  return Math.round((tasks.filter((t) => t.onTime).length / tasks.length) * 100);
}

export interface StreakInfo {
  current: number;
  longest: number;
  /** First day on which the streak reached each length, for achievements. */
  reachedOn: Map<number, string>;
}

/**
 * Streak length in calendar days, where forgiven rest days keep the streak
 * alive. A streak starts on an active day. Today being inactive never breaks it.
 */
export function streaks(activeDays: Set<string>, today: string, restDaysPerWeek: number): StreakInfo {
  const reachedOn = new Map<number, string>();
  if (activeDays.size === 0) return { current: 0, longest: 0, reachedOn };
  const sorted = [...activeDays].sort();
  const first = sorted[0]!;
  const end = activeDays.has(today) ? today : addDays(today, -1);
  if (daysBetween(first, end) < 0) return { current: 0, longest: 0, reachedOn };
  const days = classifyDays(activeDays, first, end, restDaysPerWeek);
  let run = 0;
  let longest = 0;
  let pendingRest = 0;
  for (const [day, kind] of days) {
    if (kind === "active") {
      run += pendingRest + 1;
      pendingRest = 0;
      if (run > longest) {
        for (let n = longest + 1; n <= run; n++) if (!reachedOn.has(n)) reachedOn.set(n, day);
        longest = run;
      }
    } else if (kind === "rest") {
      if (run > 0) pendingRest += 1;
    } else {
      run = 0;
      pendingRest = 0;
    }
  }
  return { current: run, longest, reachedOn };
}

/** First point at which a running total reaches a threshold. */
export function firstCrossing<T extends { at: number; amount: number; ref: string }>(
  events: T[],
  threshold: number,
): { at: number; ref: string } | null {
  const sorted = [...events].sort((a, b) => a.at - b.at || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  let total = 0;
  for (const e of sorted) {
    total += e.amount;
    if (total + 1e-9 >= threshold) return { at: e.at, ref: e.ref };
  }
  return null;
}
