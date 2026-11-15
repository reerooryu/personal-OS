/**
 * Time zones, day boundaries and period keys.
 *
 * All timestamps are UTC milliseconds. A "day" starts at the day boundary
 * (default 04:00 local), so a session at 00:30 belongs to the previous day.
 * Weeks start on Monday and use ISO week numbering.
 */

export interface TimeSettings {
  timezone: string;
  dayBoundaryMinutes: number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(utcMs: number, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of the zone from UTC at an instant, in ms (Bangkok: +7h). */
export function zoneOffset(utcMs: number, tz: string): number {
  const p = localParts(utcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Converts a local wall-clock time in a zone to UTC milliseconds. */
export function localToUtc(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall - zoneOffset(wall, tz);
  guess = wall - zoneOffset(guess, tz);
  return guess;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** The local calendar date an instant belongs to, after applying the day boundary. */
export function dayKey(utcMs: number, s: TimeSettings): string {
  const p = localParts(utcMs - s.dayBoundaryMinutes * MINUTE, s.timezone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function parseDay(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

/** ISO week key for a day key, for example "2026-W46". */
export function isoWeekOfDay(key: string): string {
  const { y, m, d } = parseDay(key);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
  date.setUTCDate(date.getUTCDate() + 4 - dow); // Thursday of this week
  const isoYear = date.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY + 1) / 7);
  return `${isoYear}-W${pad(week)}`;
}

export function weekKey(utcMs: number, s: TimeSettings): string {
  return isoWeekOfDay(dayKey(utcMs, s));
}

export type PeriodKind = "daily" | "weekly" | "long_term";

export function periodKey(kind: PeriodKind, utcMs: number, s: TimeSettings): string {
  if (kind === "daily") return dayKey(utcMs, s);
  if (kind === "weekly") return weekKey(utcMs, s);
  return "once";
}

/** Monday (as a day key) of an ISO week key. */
export function mondayOfWeek(key: string): string {
  const [yStr, wStr] = key.split("-W");
  const y = Number(yStr);
  const w = Number(wStr);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const monday = new Date(Date.UTC(y, 0, 4 - jan4Dow + 1 + (w - 1) * 7));
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

/** Start of a local day (at the day boundary) in UTC ms. */
export function dayStart(key: string, s: TimeSettings): number {
  const { y, m, d } = parseDay(key);
  return localToUtc(s.timezone, y, m, d) + s.dayBoundaryMinutes * MINUTE;
}

export function addDays(key: string, n: number): string {
  const { y, m, d } = parseDay(key);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** [start, end) of a period in UTC ms. Long-term periods are unbounded. */
export function periodRange(
  kind: PeriodKind,
  key: string,
  s: TimeSettings,
): { start: number; end: number } {
  if (kind === "daily") return { start: dayStart(key, s), end: dayStart(addDays(key, 1), s) };
  if (kind === "weekly") {
    const monday = mondayOfWeek(key);
    return { start: dayStart(monday, s), end: dayStart(addDays(monday, 7), s) };
  }
  return { start: Number.NEGATIVE_INFINITY, end: Number.POSITIVE_INFINITY };
}

/** Whole days between two day keys (b - a). */
export function daysBetween(a: string, b: string): number {
  const pa = parseDay(a);
  const pb = parseDay(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / DAY);
}
