/**
 * Calendar rules that need no database: the Week 1 / Week 2 rotation,
 * holidays, and turning timetable slots into dated occurrences.
 */
import { addDays, daysBetween, localToUtc } from "./time";

export type SlotKind = "lesson" | "tutoring" | "duty";
export type XpMode = "none" | "normal" | "small";

/** 1 = Monday ... 7 = Sunday, for a YYYY-MM-DD key. */
export function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() || 7;
}

export function mondayOf(dateKey: string): string {
  return addDays(dateKey, 1 - weekdayOf(dateKey));
}

/**
 * Week 1 or Week 2 for a date. Weeks alternate every calendar week from the
 * anchor (the Monday of any Week 1). A Sunday belongs to the week that
 * follows it: "Week 2 Sunday" is the Sunday before a Week 2 school week.
 */
export function rotationWeek(dateKey: string, anchorMonday: string): 1 | 2 {
  const d = weekdayOf(dateKey) === 7 ? addDays(dateKey, 1) : dateKey;
  const weeks = Math.round(daysBetween(anchorMonday, mondayOf(d)) / 7);
  return ((weeks % 2) + 2) % 2 === 0 ? 1 : 2;
}

export interface Break {
  name: string;
  startDate: string;
  endDate: string;
  scope: "school" | "everything";
}

/** The break covering a date, if any. Dates compare as strings (YYYY-MM-DD). */
export function breakOn(dateKey: string, breaks: Break[]): Break | null {
  return breaks.find((b) => b.startDate <= dateKey && dateKey <= b.endDate) ?? null;
}

/** Tutoring keeps going through school closures unless a break pauses everything. */
export function isPaused(kind: SlotKind, b: Break | null): boolean {
  if (!b) return false;
  return b.scope === "everything" || kind !== "tutoring";
}

export interface Slot {
  id: string;
  title: string;
  location: string | null;
  kind: SlotKind;
  weekday: number;
  week: number | null;
  startMin: number;
  endMin: number;
  skillId: string | null;
  xp: XpMode;
}

export interface SlotOccurrence {
  key: string;
  slot: Slot;
  date: string;
  week: 1 | 2;
  startAt: number;
  endAt: number;
}

export function expandSlots(slots: Slot[], fromDate: string, toDate: string, anchorMonday: string, breaks: Break[], tz: string): SlotOccurrence[] {
  const out: SlotOccurrence[] = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    const week = rotationWeek(d, anchorMonday);
    const b = breakOn(d, breaks);
    const [y, m, day] = d.split("-").map(Number);
    for (const s of slots) {
      if (s.weekday !== wd || (s.week !== null && s.week !== week) || isPaused(s.kind, b)) continue;
      const startAt = localToUtc(tz, y!, m!, day!, Math.floor(s.startMin / 60), s.startMin % 60);
      out.push({ key: `tt:${s.id}:${d}`, slot: s, date: d, week, startAt, endAt: startAt + (s.endMin - s.startMin) * 60_000 });
    }
  }
  return out;
}

/** "07:50" → 470 */
export function parseClock(s: string): number {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Bad time "${s}". Use HH:MM.`);
  const v = Number(m[1]) * 60 + Number(m[2]);
  if (v >= 24 * 60) throw new Error(`Bad time "${s}"`);
  return v;
}

// --------------------------------------------------------------------- ICS ---

export interface FeedEvent {
  uid: string;
  title: string;
  titleKey: string;
  location: string | null;
  category: string | null;
  startAt: number;
  endAt: number;
  allDay: boolean;
  cancelled: boolean;
}

const WEEKDAY_SUFFIX = /\s*\((monday|tuesday|wednesday|thursday|friday|saturday|sunday)\)\s*$/i;

/** "CANCELLED VEX Robotics Competition (Monday)" → title "VEX Robotics Competition", cancelled. */
export function cleanFeedTitle(summary: string): { title: string; titleKey: string; cancelled: boolean } {
  let t = summary.trim();
  const cancelled = /^cancel+ed\b[:\s-]*/i.test(t);
  t = t.replace(/^cancel+ed\b[:\s-]*/i, "").replace(WEEKDAY_SUFFIX, "").trim();
  return { title: t, titleKey: t.toLowerCase().replace(/\s+/g, " "), cancelled };
}

const unescapeText = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([\\;,])/g, "$1");

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): Prop | null {
  // NAME;PARAM=VALUE;PARAM="VALUE":value. Colons inside quoted params don't end the name.
  let i = 0;
  let quoted = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ":" && !quoted) break;
  }
  if (i >= line.length) return null;
  const [name, ...rawParams] = line.slice(0, i).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name!.toUpperCase(), params, value: line.slice(i + 1) };
}

function offsetMinutes(v: string): number | null {
  const m = v.trim().match(/^([+-])(\d{2})(\d{2})/);
  if (!m) return null;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function isIana(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * A small, forgiving iCalendar reader for school feeds. Handles folded lines,
 * TZIDs defined in the file (SOCS uses "Indochina Time"), IANA zones, UTC and
 * all-day dates. Recurring events are read as their first occurrence: SOCS
 * sends every session as its own event.
 */
export function parseIcs(text: string, defaultTz = "Asia/Bangkok"): FeedEvent[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const zones = new Map<string, number>();
  const blocks: Prop[][] = [];
  let tzid: string | null = null;
  let inStandard = false;
  let current: Prop[] | null = null;
  for (const raw of lines) {
    const p = parseLine(raw);
    if (!p) continue;
    if (p.name === "BEGIN" && p.value === "VEVENT") current = [];
    else if (p.name === "END" && p.value === "VEVENT") {
      if (current) blocks.push(current);
      current = null;
    } else if (current) current.push(p);
    else if (p.name === "TZID") tzid = p.value;
    else if (p.name === "BEGIN" && p.value === "STANDARD") inStandard = true;
    else if (p.name === "END" && p.value === "STANDARD") inStandard = false;
    else if (p.name === "TZOFFSETTO" && tzid && (inStandard || !zones.has(tzid))) {
      const off = offsetMinutes(p.value);
      if (off !== null) zones.set(tzid, off);
    }
  }

  const toMs = (p: Prop): { ms: number; allDay: boolean } | null => {
    const v = p.value.trim();
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return null;
    const [y, mo, d, h = "0", mi = "0", s = "0", z] = m.slice(1);
    const allDay = p.params.VALUE === "DATE" || m[4] === undefined;
    const wall = Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s);
    if (z) return { ms: wall, allDay };
    const tz = p.params.TZID;
    if (tz && zones.has(tz)) return { ms: wall - zones.get(tz)! * 60_000, allDay };
    const zone = tz && isIana(tz) ? tz : defaultTz;
    return { ms: localToUtc(zone, +y!, +mo!, +d!, +h, +mi) + +s * 1000, allDay };
  };

  const out: FeedEvent[] = [];
  for (const b of blocks) {
    const get = (n: string) => b.find((p) => p.name === n);
    const start = get("DTSTART") && toMs(get("DTSTART")!);
    if (!start) continue;
    const end = get("DTEND") ? toMs(get("DTEND")!) : null;
    const summary = unescapeText(get("SUMMARY")?.value ?? "(untitled)");
    const { title, titleKey, cancelled } = cleanFeedTitle(summary);
    const uid = get("UID")?.value ?? `${titleKey}@${start.ms}`;
    out.push({
      uid,
      title,
      titleKey,
      location: get("LOCATION") ? unescapeText(get("LOCATION")!.value).trim() || null : null,
      category: get("CATEGORIES") ? unescapeText(get("CATEGORIES")!.value).trim() || null : null,
      startAt: start.ms,
      endAt: end ? end.ms : start.ms + (start.allDay ? 86_400_000 : 3_600_000),
      allDay: start.allDay,
      cancelled: cancelled || get("STATUS")?.value.toUpperCase() === "CANCELLED",
    });
  }
  return out;
}
