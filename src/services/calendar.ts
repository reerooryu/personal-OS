/**
 * The calendar: the school timetable and tutoring (stored here), one-off
 * events, and the school's SOCS feed (read, never stored as a source).
 *
 * The calendar holds plans. An occurrence only becomes an activity when Ryu
 * answers "Did you go?". Lessons never ask and never earn XP.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { breakOn, expandSlots, parseClock, parseIcs, rotationWeek, weekdayOf, type Break, type FeedEvent, type Slot, type XpMode } from "@/domain/calendar";
import { addDays, localToUtc } from "@/domain/time";
import { MAX_DURATION_MIN } from "@/domain/defaults";
import type { Difficulty } from "@/domain/types";
import { createActivity } from "./activities";
import { getProfile } from "./context";
import { ValidationError } from "./errors";
import { getSetting, setSetting } from "./settings";

const DAY = 86_400_000;
const INBOX_DAYS = 7;

export type OccurrenceKind = "lesson" | "tutoring" | "duty" | "event" | "school" | "test";

export interface Occurrence {
  key: string;
  source: "timetable" | "event" | "feed" | "test";
  kind: OccurrenceKind;
  title: string;
  location: string | null;
  startAt: number;
  endAt: number;
  allDay: boolean;
  week: 1 | 2 | null;
  skillId: string | null;
  xp: XpMode;
  activityTypeId: string;
  cancelled: boolean;
  /** A feed event whose title has no rule yet: ask which skill it trains. */
  needsSkill: boolean;
  status: "done" | "skipped" | null;
  activityId: string | null;
  /** For events: what kind (colors the calendar), the group of its parts, and whether Ryu added it. */
  category?: EventKind;
  groupId?: string | null;
  mine?: boolean;
}

export type EventKind = "event" | "competition" | "meetup" | "friends";

function tz(db: DB) {
  return getProfile(db).timezone;
}

/** Local date key (no day boundary) for an instant. */
function localDate(ms: number, zone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  return p;
}

export function todayKey(db: DB, now = Date.now()): string {
  return localDate(now, tz(db));
}

export function weekAnchor(db: DB): string | null {
  return getSetting(db, "weekAnchor");
}

export function currentWeek(db: DB, dateKey: string): 1 | 2 | null {
  const a = weekAnchor(db);
  return a ? rotationWeek(dateKey, a) : null;
}

/** Swaps Week 1 and Week 2 from now on (for when a holiday resets the rotation). */
export function flipWeek(db: DB): void {
  const a = weekAnchor(db);
  if (!a) throw ValidationError.one("weekAnchor", "No timetable yet");
  setSetting(db, "weekAnchor", addDays(a, 7));
}

function breaks(db: DB) {
  return db.select().from(t.schoolBreaks).all();
}

// ------------------------------------------------------------ skill rules ---

function attributeTypes(db: DB) {
  const DEFAULT: Record<string, string> = { academics: "study", athletics: "training", engineering: "project", creative: "practice" };
  return new Map(db.select().from(t.skills).all().map((s) => [s.id, DEFAULT[s.attributeId] ?? "practice"]));
}

/**
 * Finds a skill named in a title: "VEX Robotics Competition" → robotics (alias
 * "vex"). The name that appears first wins, so "DT Production Run" is Design
 * Technology, not Track.
 */
export function suggestSkillForTitle(db: DB, titleKey: string): string | null {
  const words = ` ${titleKey.replace(/[^a-z0-9&]+/g, " ")} `;
  let best: { id: string; at: number; len: number } | null = null;
  for (const s of db.select().from(t.skills).all()) {
    if (s.archived || s.kind === "trait") continue;
    for (const name of [s.name, ...(s.aliases ?? [])]) {
      const n = name.toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim();
      const at = n ? words.indexOf(` ${n} `) : -1;
      if (at >= 0 && (!best || at < best.at || (at === best.at && n.length > best.len))) best = { id: s.id, at, len: n.length };
    }
  }
  return best?.id ?? null;
}

function defaultType(db: DB, skillId: string, titleKey: string) {
  if (/\blesson\b/.test(titleKey)) return "lesson";
  return attributeTypes(db).get(skillId) ?? "practice";
}

/** Creates rules for feed titles seen for the first time, when the skill is obvious. */
function ensureRules(db: DB, events: FeedEvent[]) {
  for (const key of new Set(events.map((e) => e.titleKey))) {
    if (db.select().from(t.calendarRules).where(eq(t.calendarRules.titleKey, key)).get()) continue;
    const skillId = suggestSkillForTitle(db, key);
    if (skillId) db.insert(t.calendarRules).values({ titleKey: key, action: "log", skillId, activityTypeId: defaultType(db, skillId, key), xp: "normal" }).run();
  }
}

export function calendarRuleList(db: DB) {
  // Show titles as the school spells them ("DT Production Run"), not the lower-case key.
  const names = new Map(db.select().from(t.externalEvents).all().map((e) => [e.titleKey, e.title]));
  return db
    .select()
    .from(t.calendarRules)
    .all()
    .sort((a, b) => a.titleKey.localeCompare(b.titleKey))
    .map((r) => ({ ...r, title: names.get(r.titleKey) ?? r.titleKey.replace(/\b\w/g, (c) => c.toUpperCase()) }));
}

export function setCalendarRule(db: DB, titleKey: string, rule: { action: "log" | "ignore"; skillId?: string | null; xp?: "normal" | "small" }) {
  if (rule.action === "log" && !rule.skillId) throw ValidationError.one("skillId", "Pick a skill");
  const values = {
    titleKey,
    action: rule.action,
    skillId: rule.action === "log" ? rule.skillId! : null,
    activityTypeId: rule.action === "log" ? defaultType(db, rule.skillId!, titleKey) : null,
    xp: rule.xp ?? "normal",
  };
  db.insert(t.calendarRules)
    .values(values)
    .onConflictDoUpdate({ target: t.calendarRules.titleKey, set: { action: values.action, skillId: values.skillId, activityTypeId: values.activityTypeId, xp: values.xp } })
    .run();
}

// ------------------------------------------------------------ occurrences ---

function slotType(kind: Slot["kind"], xp: XpMode) {
  if (xp === "small") return "light";
  return kind === "tutoring" ? "lesson" : "practice";
}

/** Everything on the calendar between two dates (inclusive), sorted by start. */
export function occurrences(db: DB, fromDate: string, toDate: string): Occurrence[] {
  const zone = tz(db);
  const anchor = weekAnchor(db);
  const confirmations = new Map(db.select().from(t.calendarConfirmations).all().map((c) => [c.occurrenceKey, c]));
  const status = (key: string) => {
    const c = confirmations.get(key);
    return { status: c?.status ?? null, activityId: c?.activityId ?? null };
  };
  const out: Occurrence[] = [];

  if (anchor) {
    const slots = db.select().from(t.timetableSlots).all() as Slot[];
    for (const o of expandSlots(slots, fromDate, toDate, anchor, breaks(db), zone)) {
      out.push({
        key: o.key,
        source: "timetable",
        kind: o.slot.kind,
        title: o.slot.title,
        location: o.slot.location,
        startAt: o.startAt,
        endAt: o.endAt,
        allDay: false,
        week: o.week,
        skillId: o.slot.skillId,
        xp: o.slot.xp,
        activityTypeId: slotType(o.slot.kind, o.slot.xp),
        cancelled: false,
        needsSkill: false,
        ...status(o.key),
      });
    }
  }

  const from = localToUtc(zone, ...ymd(fromDate));
  const to = localToUtc(zone, ...ymd(addDays(toDate, 1)));
  for (const e of db.select().from(t.calendarEvents).all()) {
    if (e.endAt <= from || e.startAt >= to) continue;
    const key = `ev:${e.id}`;
    out.push({
      key,
      source: "event",
      kind: "event",
      title: e.title,
      location: e.location,
      startAt: e.startAt,
      endAt: e.endAt,
      allDay: e.allDay,
      week: anchor ? rotationWeek(localDate(e.startAt, zone), anchor) : null,
      skillId: e.skillId,
      xp: e.allDay ? "none" : e.xp,
      activityTypeId: e.activityTypeId ?? (e.xp === "small" ? "light" : "practice"),
      cancelled: false,
      needsSkill: false,
      category: e.kind,
      groupId: e.groupId ?? e.id,
      mine: e.origin === "app",
      ...status(key),
    });
  }

  const rules = new Map(db.select().from(t.calendarRules).all().map((r) => [r.titleKey, r]));
  for (const e of db.select().from(t.externalEvents).all()) {
    if (e.endAt <= from || e.startAt >= to) continue;
    const rule = rules.get(e.titleKey);
    const key = `feed:${e.uid}`;
    out.push({
      key,
      source: "feed",
      kind: "school",
      title: e.title,
      location: e.location,
      startAt: e.startAt,
      endAt: e.endAt,
      allDay: e.allDay,
      week: anchor ? rotationWeek(localDate(e.startAt, zone), anchor) : null,
      skillId: rule?.action === "log" ? rule.skillId : null,
      xp: !rule ? "normal" : rule.action === "ignore" ? "none" : rule.xp,
      activityTypeId: rule?.activityTypeId ?? "practice",
      cancelled: e.cancelled,
      needsSkill: !rule && !e.allDay,
      ...status(key),
    });
  }
  // Tests: shown in place of the lesson they fall in.
  const tests = db.select().from(t.tests).all().filter((x) => x.startAt < to && x.startAt + x.durationMin * 60_000 > from);
  for (const x of tests) {
    const key = `test:${x.id}`;
    out.push({
      key,
      source: "test",
      kind: "test",
      title: x.title,
      location: null,
      startAt: x.startAt,
      endAt: x.startAt + x.durationMin * 60_000,
      allDay: false,
      week: anchor ? rotationWeek(localDate(x.startAt, zone), anchor) : null,
      skillId: x.skillId,
      xp: "none",
      activityTypeId: "exam",
      cancelled: false,
      needsSkill: false,
      status: null,
      activityId: null,
    });
  }
  const replaced = (o: Occurrence) =>
    o.kind === "lesson" && tests.some((x) => x.skillId === o.skillId && x.startAt < o.endAt && x.startAt + x.durationMin * 60_000 > o.startAt);
  for (const o of out) if (o.kind === "test") o.location = out.find((l) => l.kind === "lesson" && l.skillId === o.skillId && l.startAt <= o.startAt && o.startAt < l.endAt)?.location ?? null;
  return out.filter((o) => !replaced(o)).sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt);
}

function ymd(key: string): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y!, m!, d!];
}

/** One week (Monday to Sunday) around a date, with each day's break if any. */
export function calendarWeek(db: DB, anyDate: string) {
  const monday = addDays(anyDate, 1 - weekdayOf(anyDate));
  const sunday = addDays(monday, 6);
  const bs = breaks(db);
  const zone = tz(db);
  const dueByDay = new Map<string, number>();
  for (const h of db.select().from(t.homework).all()) {
    if (h.completedAt) continue;
    const d = localDate(h.dueAt, zone);
    dueByDay.set(d, (dueByDay.get(d) ?? 0) + 1);
  }
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    // A Sunday belongs to the rotation week after it.
    const anchor = weekAnchor(db);
    const rot = anchor && weekdayOf(date) === 7 ? rotationWeek(date, anchor) : null;
    return { date, break: breakOn(date, bs)?.name ?? null, week: rot, due: dueByDay.get(date) ?? 0 };
  });
  return { monday, days, week: currentWeek(db, monday), items: occurrences(db, monday, sunday) };
}

// ------------------------------------------------------------------ inbox ---

/** The first time a timetable or feed arrives. Sessions before it are history, not questions. */
function markCalendarStart(db: DB, now = Date.now()) {
  if (getSetting(db, "calendarSince") === null) setSetting(db, "calendarSince", now);
}

/** Ended sessions from the last week that can earn XP and haven't been answered. */
export function calendarInbox(db: DB, now = Date.now()): Occurrence[] {
  const zone = tz(db);
  const today = localDate(now, zone);
  return occurrences(db, addDays(today, -INBOX_DAYS), today)
    .filter((o) => o.endAt <= now && o.endAt > Math.max(now - INBOX_DAYS * DAY, getSetting(db, "calendarSince") ?? 0) && !o.cancelled && o.status === null && !o.allDay && (o.xp !== "none" || o.needsSkill))
    .reverse();
}

export interface CalendarAnswer {
  key: string;
  answer: "went" | "missed" | "never";
  /** For feed events with no rule yet. */
  skillId?: string;
  /** Make the skill choice (or "never") a rule for this title. */
  remember?: boolean;
}

function find(db: DB, key: string, now: number): Occurrence {
  const zone = tz(db);
  const today = localDate(now, zone);
  const o = occurrences(db, addDays(today, -60), addDays(today, 1)).find((x) => x.key === key);
  if (!o) throw ValidationError.one("key", "That session is no longer on the calendar");
  return o;
}

function overlapping(db: DB, o: Occurrence, skillId: string) {
  for (const a of db.select().from(t.activities).where(isNull(t.activities.deletedAt)).all()) {
    const aEnd = a.startAt + a.durationMin * 60_000;
    const overlap = Math.min(o.endAt, aEnd) - Math.max(o.startAt, a.startAt);
    if (overlap <= 0 || overlap < Math.min(o.endAt - o.startAt, aEnd - a.startAt) * 0.5) continue;
    const skills = db.select().from(t.activitySkills).where(eq(t.activitySkills.activityId, a.id)).all();
    if (skills.some((s) => s.skillId === skillId)) return a;
  }
  return null;
}

export function answerCalendar(db: DB, ans: CalendarAnswer, now = Date.now()) {
  const o = find(db, ans.key, now);
  if (o.startAt > now) throw ValidationError.one("key", "That session hasn't happened yet");
  if (o.cancelled) throw ValidationError.one("key", "That session was cancelled");
  if (o.xp === "none" && !o.needsSkill && ans.answer !== "never") throw ValidationError.one("key", "Lessons and untracked sessions aren't logged");
  const titleKey = o.title.toLowerCase().replace(/\s+/g, " ");
  if (ans.answer === "never") {
    if (o.source !== "feed") throw ValidationError.one("answer", "Only school events can be untracked");
    setCalendarRule(db, titleKey, { action: "ignore" });
    return { activityId: null, xp: 0 };
  }
  if (ans.answer === "missed") {
    db.insert(t.calendarConfirmations).values({ occurrenceKey: o.key, status: "skipped", activityId: null, decidedAt: now }).onConflictDoNothing().run();
    return { activityId: null, xp: 0 };
  }
  const skillId = o.skillId ?? ans.skillId;
  if (!skillId) throw ValidationError.one("skillId", "Pick a skill");
  if (o.needsSkill && ans.remember) setCalendarRule(db, titleKey, { action: "log", skillId });
  const existing = overlapping(db, o, skillId);
  if (existing) {
    db.insert(t.calendarConfirmations).values({ occurrenceKey: o.key, status: "done", activityId: existing.id, decidedAt: now }).onConflictDoNothing().run();
    return { activityId: existing.id, xp: 0, matched: true };
  }
  const small = o.xp === "small";
  const type = o.needsSkill ? defaultType(db, skillId, titleKey) : o.activityTypeId;
  const r = createActivity(
    db,
    {
      name: o.title,
      notes: o.location ? `From the calendar · ${o.location}` : "From the calendar",
      startAt: o.startAt,
      durationMin: Math.min(MAX_DURATION_MIN, Math.max(1, Math.round((o.endAt - o.startAt) / 60_000))),
      activityTypeId: small ? "light" : type,
      difficulty: (small ? "very_easy" : "normal") as Difficulty,
      skills: [{ skillId, weight: 100 }],
      source: "inbox",
      clientRequestId: `cal:${o.key}`,
      confirmLong: true,
    },
    now,
  );
  db.insert(t.calendarConfirmations).values({ occurrenceKey: o.key, status: "done", activityId: r.activity.id, decidedAt: now }).onConflictDoNothing().run();
  return { activityId: r.activity.id, xp: r.xp };
}

// ------------------------------------------------------------------- feed ---

export function feedUrl(raw: string): string {
  const u = raw.trim().replace(/^webcals?:\/\//i, "https://");
  if (!/^https:\/\/[^\s]+$/i.test(u)) throw ValidationError.one("url", "That doesn't look like a calendar link");
  return u;
}

/** Replaces the cached feed. Rules are created for obviously-named new titles. */
export function storeFeed(db: DB, events: FeedEvent[], now = Date.now()) {
  db.transaction((tx) => {
    tx.delete(t.externalEvents).run();
    const seen = new Set<string>();
    for (const e of events) {
      if (seen.has(e.uid)) continue;
      seen.add(e.uid);
      tx.insert(t.externalEvents).values(e).run();
    }
  });
  ensureRules(db, events);
  setSetting(db, "socsLastFetch", { at: now, error: null, count: events.length });
  markCalendarStart(db, now);
}

/** Fetches the SOCS feed. `fetcher` is injectable for tests. */
export async function refreshFeed(db: DB, fetcher: typeof fetch = fetch, now = Date.now()) {
  const raw = getSetting(db, "socsFeedUrl");
  if (!raw) return { ok: false as const, error: "No school calendar link yet" };
  try {
    const res = await fetcher(feedUrl(raw), { signal: AbortSignal.timeout(20_000), headers: { accept: "text/calendar" } });
    if (!res.ok) throw new Error(`The school calendar answered ${res.status}`);
    const text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("That link didn't return a calendar");
    const events = parseIcs(text, tz(db));
    storeFeed(db, events, now);
    return { ok: true as const, count: events.length };
  } catch (e) {
    const error = (e as Error).name === "TimeoutError" ? "The school calendar didn't answer in time" : (e as Error).message;
    setSetting(db, "socsLastFetch", { at: now, error, count: getSetting(db, "socsLastFetch")?.count ?? 0 });
    return { ok: false as const, error };
  }
}

// ------------------------------------------------------- Apple Calendar out ---

export interface OutboxItem {
  uid: string;
  title: string;
  location: string | null;
  notes: string;
  start: number;
  end: number;
  allDay?: boolean;
}

const CATEGORY_LABEL: Record<EventKind, string> = { event: "Event", competition: "Competition", meetup: "Meetup", friends: "Friends" };

const KIND_LABEL: Record<OccurrenceKind, string> = { lesson: "Lesson", tutoring: "Tutoring", duty: "School duty", event: "Event", school: "School", test: "Test" };

/**
 * What ASCEND puts in the "ASCEND" calendar in Apple Calendar: the timetable,
 * tutoring and one-off events, from a week ago to eight weeks ahead. School
 * feed events are left out, since SOCS already puts them there.
 */
export function appleOutbox(db: DB, now = Date.now()) {
  const today = todayKey(db, now);
  const from = addDays(today, -7);
  const to = addDays(today, 56);
  const notes = new Map(db.select({ id: t.calendarEvents.id, notes: t.calendarEvents.notes }).from(t.calendarEvents).all().map((e) => [`ev:${e.id}`, e.notes]));
  const items: OutboxItem[] = occurrences(db, from, to)
    .filter((o) => o.source !== "feed")
    .map((o) => ({
      uid: o.key,
      title: o.title,
      location: o.location,
      notes: [
        notes.get(o.key),
        [o.category ? CATEGORY_LABEL[o.category] : KIND_LABEL[o.kind], o.week ? `Week ${o.week}` : null, "Added by ASCEND"].filter(Boolean).join(" · "),
      ]
        .filter(Boolean)
        .join("\n\n"),
      start: o.startAt,
      end: o.endAt,
      ...(o.allDay ? { allDay: true } : {}),
    }));
  const zone = tz(db);
  const fromMs = localToUtc(zone, ...ymd(from));
  const toMs = localToUtc(zone, ...ymd(addDays(to, 1)));
  const hash = createHash("sha1").update(JSON.stringify(items)).digest("hex");
  return { calendarName: "ASCEND", from: fromMs, to: toMs, items, hash };
}

// --------------------------------------------------- private timetable file ---

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const fileSchema = z.object({
  weekAnchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  socsFeedUrl: z.string().optional(),
  slots: z.array(
    z.object({
      title: z.string().min(1),
      location: z.string().nullish(),
      kind: z.enum(["lesson", "tutoring", "duty"]),
      day: z.string(),
      week: z.union([z.literal(1), z.literal(2), z.null()]).default(null),
      start: z.string(),
      end: z.string(),
      skill: z.string().nullish(),
      xp: z.enum(["none", "normal", "small"]).optional(),
    }),
  ),
  events: z
    .array(
      z.object({
        title: z.string().min(1),
        location: z.string().nullish(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        start: z.string(),
        end: z.string(),
        skill: z.string().nullish(),
        xp: z.enum(["none", "normal", "small"]).default("none"),
      }),
    )
    .default([]),
  breaks: z
    .array(
      z.object({
        name: z.string().min(1),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        scope: z.enum(["school", "everything"]),
      }),
    )
    .default([]),
});
export type TimetableFile = z.input<typeof fileSchema>;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Replaces the timetable, one-off events and breaks with the file's. Slot ids
 * are built from day, week, time and title, so answers to "Did you go?"
 * survive a re-import when nothing about a slot changed.
 */
export function importTimetable(db: DB, raw: unknown, now = Date.now()) {
  const p = fileSchema.safeParse(raw);
  if (!p.success) throw ValidationError.one("file", `Timetable file: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}`);
  const f = p.data;
  const zone = tz(db);
  const skillIds = new Set(db.select().from(t.skills).all().map((s) => s.id));
  const checkSkill = (s: string | null | undefined, where: string) => {
    if (s && !skillIds.has(s)) throw ValidationError.one("file", `Unknown skill "${s}" in ${where}`);
    return s ?? null;
  };
  const slots = f.slots.map((s) => {
    const weekday = DAYS.indexOf(s.day.trim().slice(0, 3).toLowerCase()) + 1;
    if (!weekday) throw ValidationError.one("file", `Unknown day "${s.day}" for ${s.title}`);
    const startMin = parseClock(s.start);
    const endMin = parseClock(s.end);
    if (endMin <= startMin) throw ValidationError.one("file", `${s.title} on ${s.day} ends before it starts`);
    const xp: XpMode = s.xp ?? (s.kind === "lesson" ? "none" : s.kind === "duty" ? "small" : "normal");
    return {
      id: `${DAYS[weekday - 1]}-w${s.week ?? "x"}-${s.start.replace(":", "")}-${slug(s.title)}`,
      title: s.title,
      location: s.location ?? null,
      kind: s.kind,
      weekday,
      week: s.week,
      startMin,
      endMin,
      skillId: checkSkill(s.skill, s.title),
      xp,
    };
  });
  const events = f.events.map((e) => {
    const [y, m, d] = ymd(e.date);
    const s = parseClock(e.start);
    const en = parseClock(e.end);
    return {
      id: `${e.date}-${slug(e.title)}`,
      title: e.title,
      location: e.location ?? null,
      startAt: localToUtc(zone, y, m, d, Math.floor(s / 60), s % 60),
      endAt: localToUtc(zone, y, m, d, Math.floor(en / 60), en % 60),
      skillId: checkSkill(e.skill, e.title),
      xp: e.xp,
    };
  });
  db.transaction((tx) => {
    tx.delete(t.timetableSlots).run();
    tx.delete(t.calendarEvents).where(eq(t.calendarEvents.origin, "file")).run();
    tx.delete(t.schoolBreaks).run();
    for (const s of slots) tx.insert(t.timetableSlots).values(s).run();
    for (const e of events) tx.insert(t.calendarEvents).values(e).run();
    for (const b of f.breaks) tx.insert(t.schoolBreaks).values({ id: `${b.from}-${slug(b.name)}`, name: b.name, startDate: b.from, endDate: b.to, scope: b.scope }).run();
  });
  // Keep a week flip made in the app: only take the file's anchor when the file's anchor changed.
  const lastFileAnchor = getSetting(db, "timetableHash")?.split("|")[1];
  if (!weekAnchor(db) || lastFileAnchor !== f.weekAnchor) setSetting(db, "weekAnchor", f.weekAnchor);
  if (f.socsFeedUrl) setSetting(db, "socsFeedUrl", f.socsFeedUrl);
  markCalendarStart(db, now);
  return { slots: slots.length, events: events.length, breaks: f.breaks.length, anchor: f.weekAnchor };
}

/** Imports the file if it changed since the last import. Used at startup. */
export function syncTimetableFile(db: DB, text: string) {
  const hash = createHash("sha1").update(text).digest("hex");
  const prev = getSetting(db, "timetableHash");
  if (prev?.startsWith(hash)) return null;
  const json = JSON.parse(text) as { weekAnchor?: string };
  const r = importTimetable(db, json);
  setSetting(db, "timetableHash", `${hash}|${json.weekAnchor ?? ""}`);
  return r;
}

// ------------------------------------------------------------------ breaks ---

export function breakList(db: DB) {
  return breaks(db).sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function setBreakScope(db: DB, id: string, scope: "school" | "everything") {
  db.update(t.schoolBreaks).set({ scope }).where(eq(t.schoolBreaks.id, id)).run();
}

export function upcomingTimetableCount(db: DB) {
  return db.select().from(t.timetableSlots).all().length;
}

/** Confirmations for a day, used to undo. */
export function undoAnswer(db: DB, key: string) {
  db.delete(t.calendarConfirmations).where(and(eq(t.calendarConfirmations.occurrenceKey, key), eq(t.calendarConfirmations.status, "skipped"))).run();
}

// ---------------------------------------------------------- Ryu's own events ---

const eventInput = z
  .object({
    title: z.string().trim().min(1, "Give it a name").max(120),
    kind: z.enum(["event", "competition", "meetup", "friends"]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day"),
    allDay: z.boolean().default(false),
    /** One or more parts in order, such as school 15:00–18:00 then a friend's room 18:00–19:30. */
    parts: z
      .array(z.object({ start: z.string(), end: z.string(), location: z.string().trim().max(120).nullish() }))
      .min(1)
      .max(4),
    /** The skill it trains, for "Did you go?". None means it's on the calendar only. */
    skillId: z.string().nullish(),
    notes: z.string().trim().max(2000).nullish(),
  })
  .superRefine((e, ctx) => {
    if (e.allDay) return;
    let last = -1;
    e.parts.forEach((p, i) => {
      const s = /^\d{1,2}:\d{2}$/.test(p.start) ? parseClock(p.start) : NaN;
      const en = /^\d{1,2}:\d{2}$/.test(p.end) ? parseClock(p.end) : NaN;
      if (!(en > s)) ctx.addIssue({ code: "custom", path: ["parts", i, "end"], message: "Each part must end after it starts" });
      if (s < last) ctx.addIssue({ code: "custom", path: ["parts", i, "start"], message: "Parts must be in order" });
      last = en;
    });
  });
export type EventInput = z.input<typeof eventInput>;

/** Friends' plans never count for XP: they're on the calendar so the day is planned, not to be scored. */
function eventXp(kind: EventKind, skillId: string | null): XpMode {
  return kind === "friends" || !skillId ? "none" : "normal";
}

/** Saves one of Ryu's events, replacing every part of `groupId` when editing. */
export function saveEvent(db: DB, groupId: string | null, raw: EventInput) {
  const p = eventInput.safeParse(raw);
  if (!p.success) throw ValidationError.one(String(p.error.issues[0]?.path.join(".") ?? "event"), p.error.issues[0]?.message ?? "Check the event");
  const e = p.data;
  if (e.skillId) {
    const s = db.select().from(t.skills).where(eq(t.skills.id, e.skillId)).get();
    if (!s || s.kind === "trait") throw ValidationError.one("skillId", "Pick a skill");
  }
  if (groupId) {
    const existing = eventParts(db, groupId);
    if (!existing.length || existing.some((x) => x.origin !== "app")) throw ValidationError.one("id", "That event can't be edited here");
  }
  const zone = tz(db);
  const [y, m, d] = ymd(e.date);
  const skillId = e.kind === "friends" ? null : (e.skillId ?? null);
  const xp = eventXp(e.kind, skillId);
  const activityTypeId = skillId ? (e.kind === "competition" ? "competition" : defaultType(db, skillId, e.title.toLowerCase())) : null;
  const gid = groupId ?? randomUUID();
  const rows = (e.allDay ? [{ start: "00:00", end: "00:00", location: e.parts[0]?.location }] : e.parts).map((part, i) => {
    const s = e.allDay ? 0 : parseClock(part.start);
    const en = e.allDay ? 24 * 60 : parseClock(part.end);
    const startAt = localToUtc(zone, y, m, d, Math.floor(s / 60), s % 60);
    const endAt = e.allDay ? localToUtc(zone, ...ymd(addDays(e.date, 1))) : localToUtc(zone, y, m, d, Math.floor(en / 60), en % 60);
    return {
      id: `${gid}-${i + 1}`,
      title: e.title,
      location: part.location || null,
      startAt,
      endAt,
      skillId,
      xp,
      origin: "app" as const,
      kind: e.kind,
      allDay: e.allDay,
      groupId: gid,
      activityTypeId,
      notes: e.notes || null,
    };
  });
  db.transaction((tx) => {
    tx.delete(t.calendarEvents).where(eq(t.calendarEvents.groupId, gid)).run();
    for (const r of rows) tx.insert(t.calendarEvents).values(r).run();
  });
  return { groupId: gid, parts: rows.length };
}

/** Every part of an event: by its group, or the single row of a file event that has none. */
function eventParts(db: DB, groupId: string) {
  return db.select().from(t.calendarEvents).where(or(eq(t.calendarEvents.groupId, groupId), eq(t.calendarEvents.id, groupId))).all();
}

export function deleteEvent(db: DB, groupId: string) {
  const rows = eventParts(db, groupId);
  if (!rows.length) return;
  if (rows.some((x) => x.origin !== "app")) throw ValidationError.one("id", "That event comes from the timetable file");
  db.delete(t.calendarEvents).where(eq(t.calendarEvents.groupId, groupId)).run();
}

/** Ryu's events on days `from` to `to` (inclusive), in a form the event dialog can edit, keyed by group. */
export function editableEvents(db: DB, from: string, to: string) {
  const zone = tz(db);
  const fromMs = localToUtc(zone, ...ymd(from));
  const toMs = localToUtc(zone, ...ymd(addDays(to, 1)));
  const clock = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  const groups = new Map<string, (typeof t.calendarEvents.$inferSelect)[]>();
  for (const r of db.select().from(t.calendarEvents).where(eq(t.calendarEvents.origin, "app")).all()) {
    if (r.endAt <= fromMs || r.startAt >= toMs) continue;
    const g = r.groupId ?? r.id;
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  const out: Record<string, EventInput & { groupId: string }> = {};
  for (const [g, parts] of groups) {
    parts.sort((a, b) => a.startAt - b.startAt);
    const f = parts[0]!;
    out[g] = {
      groupId: g,
      title: f.title,
      kind: f.kind,
      date: localDate(f.startAt, zone),
      allDay: f.allDay,
      parts: parts.map((p) => ({ start: clock(p.startAt), end: p.allDay ? "23:59" : clock(p.endAt), location: p.location })),
      skillId: f.skillId,
      notes: f.notes,
    };
  }
  return out;
}
