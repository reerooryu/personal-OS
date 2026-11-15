import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { cleanFeedTitle, parseIcs, rotationWeek, weekdayOf } from "@/domain/calendar";
import { createActivity } from "@/services/activities";
import { verify } from "@/services/engine";
import {
  answerCalendar,
  appleOutbox,
  calendarInbox,
  calendarWeek,
  feedUrl,
  flipWeek,
  importTimetable,
  occurrences,
  refreshFeed,
  storeFeed,
  suggestSkillForTitle,
  syncTimetableFile,
  type TimetableFile,
} from "@/services/calendar";
import { getSetting, setSetting } from "@/services/settings";
import { bkk, seededDb, skillXp } from "./helpers";

/** A made-up timetable in the same shape as the real (private) one. */
const FILE: TimetableFile = {
  weekAnchor: "2026-11-16",
  slots: [
    { title: "English", location: "S223", kind: "lesson", day: "Mon", week: 1, start: "07:50", end: "08:45", skill: "english" },
    { title: "Economics", location: "S328", kind: "lesson", day: "Mon", week: 2, start: "07:50", end: "09:45", skill: "economics" },
    { title: "Biology", kind: "tutoring", day: "Mon", week: null, start: "20:30", end: "22:00", skill: "biology" },
    { title: "Admissions Office", kind: "duty", day: "Sun", week: 2, start: "11:30", end: "13:00", skill: "resilience" },
  ],
  events: [{ title: "Military Training Exam", location: "Territorial Defense School", date: "2026-11-28", start: "07:45", end: "12:00", skill: "resilience", xp: "small" }],
  breaks: [
    { name: "School closed", from: "2026-12-07", to: "2026-12-07", scope: "school" },
    { name: "Christmas holidays", from: "2026-12-19", to: "2027-01-10", scope: "everything" },
  ],
};

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//SOCS//SchoolCalendar//EN",
  "BEGIN:VTIMEZONE",
  "TZID:Indochina Time",
  "BEGIN:STANDARD",
  "DTSTART:16010101T000000",
  "TZOFFSETFROM:+0700",
  "TZOFFSETTO:+0700",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:vex-1@socs",
  "SUMMARY:VEX Robotics Competition (Monday)",
  "LOCATION:A205",
  "DTSTART;TZID=Indochina Time:20261116T150000",
  "DTEND;TZID=Indochina Time:20261116T155500",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:econ-1@socs",
  "SUMMARY:CANCELLED Economics Olympiad (Tuesday)",
  "DTSTART;TZID=Indochina Time:20261117T150000",
  "DTEND;TZID=Indochina Time:20261117T155500",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:doe-1@socs",
  "SUMMARY:Y11 DOEIA (Fri",
  " day)",
  "DTSTART:20261120T080000Z",
  "DTEND:20261120T090000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:piano-1@socs",
  "SUMMARY:Piano Lesson",
  "CATEGORIES:Music Lesson",
  "LOCATION:P411",
  "DTSTART;TZID=Indochina Time:20261118T120000",
  "DTEND;TZID=Indochina Time:20261118T123000",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const H = 3_600_000;
/** When the calendar was "set up" in these tests. */
const SETUP = bkk(2026, 11, 1);

describe("rotation", () => {
  it("alternates weeks from the anchor, with Sunday belonging to the week after it", () => {
    const a = "2026-11-16";
    expect(rotationWeek("2026-11-16", a)).toBe(1);
    expect(rotationWeek("2026-11-21", a)).toBe(1); // Saturday
    expect(rotationWeek("2026-11-22", a)).toBe(2); // Sunday before a Week 2 school week
    expect(rotationWeek("2026-11-23", a)).toBe(2);
    expect(rotationWeek("2026-11-15", a)).toBe(1); // Sunday before this Week 1
    expect(rotationWeek("2026-11-09", a)).toBe(2); // works backwards too
    expect(rotationWeek("2027-01-11", a)).toBe(1);
    expect(weekdayOf("2026-11-22")).toBe(7);
  });

  it("reads SOCS-style titles", () => {
    expect(cleanFeedTitle("CANCELLED VEX Robotics Competition (Monday)")).toEqual({ title: "VEX Robotics Competition", titleKey: "vex robotics competition", cancelled: true });
    expect(cleanFeedTitle("Piano Lesson").cancelled).toBe(false);
  });

  it("parses the feed: custom time zone, folded lines, UTC, cancellations", () => {
    const ev = parseIcs(ICS);
    expect(ev).toHaveLength(4);
    expect(ev[0]).toMatchObject({ title: "VEX Robotics Competition", location: "A205", startAt: bkk(2026, 11, 16, 15), endAt: bkk(2026, 11, 16, 15, 55), cancelled: false });
    expect(ev[1]).toMatchObject({ title: "Economics Olympiad", cancelled: true });
    expect(ev[2]).toMatchObject({ title: "Y11 DOEIA", startAt: Date.UTC(2026, 10, 20, 8) });
    expect(ev[3]).toMatchObject({ category: "Music Lesson" });
  });
});

describe("timetable", () => {
  it("expands the right week, pauses lessons on closures and everything over Christmas", () => {
    const db = seededDb();
    importTimetable(db, FILE, SETUP);
    const titles = (from: string, to: string) => occurrences(db, from, to).map((o) => `${o.title}@${o.startAt}`);
    // Week 1 Monday: English, not Economics.
    expect(occurrences(db, "2026-11-16", "2026-11-16").map((o) => o.title)).toEqual(["English", "Biology"]);
    // Week 2 Monday, and the Sunday before it.
    expect(occurrences(db, "2026-11-22", "2026-11-23").map((o) => o.title)).toEqual(["Admissions Office", "Economics", "Biology"]);
    // 7 Dec is a Week 2 Monday with the school closed: no lessons, tutoring still on.
    // (The Sunday before it is a Week 2 Sunday, outside the closure.)
    expect(occurrences(db, "2026-12-06", "2026-12-07").map((o) => o.title)).toEqual(["Admissions Office", "Biology"]);
    // Christmas: nothing.
    expect(titles("2026-12-19", "2027-01-10")).toEqual([]);
    expect(occurrences(db, "2027-01-11", "2027-01-11").map((o) => o.title)).toEqual(["English", "Biology"]);
    // The one-off exam.
    expect(occurrences(db, "2026-11-28", "2026-11-28")[0]).toMatchObject({ title: "Military Training Exam", startAt: bkk(2026, 11, 28, 7, 45), xp: "small" });
  });

  it("flipping the week swaps the rotation, and re-importing the same file keeps the flip", () => {
    const db = seededDb();
    const text = JSON.stringify(FILE);
    syncTimetableFile(db, text);
    flipWeek(db);
    expect(occurrences(db, "2026-11-16", "2026-11-16").map((o) => o.title)).toEqual(["Economics", "Biology"]);
    expect(syncTimetableFile(db, text)).toBeNull();
    syncTimetableFile(db, JSON.stringify({ ...FILE, slots: FILE.slots.slice(0, 3) }));
    expect(getSetting(db, "weekAnchor")).toBe("2026-11-23");
  });

  it("rejects unknown skills and bad times", () => {
    const db = seededDb();
    expect(() => importTimetable(db, { ...FILE, slots: [{ ...FILE.slots[0]!, skill: "underwater-basket-weaving" }] })).toThrow(/Unknown skill/);
    expect(() => importTimetable(db, { ...FILE, slots: [{ ...FILE.slots[0]!, end: "07:00" }] })).toThrow(/ends before/);
  });
});

describe("Did you go?", () => {
  it("asks about tutoring and duties, never about lessons, and logs with the right XP", () => {
    const db = seededDb();
    importTimetable(db, FILE, SETUP);
    const now = bkk(2026, 11, 28, 13);
    const inbox = calendarInbox(db, now);
    // Newest first, last 7 days only.
    expect(inbox.map((o) => o.title)).toEqual(["Military Training Exam", "Biology", "Admissions Office"]);
    expect(inbox.some((o) => o.kind === "lesson")).toBe(false);

    const tutoring = inbox[1]!;
    const r = answerCalendar(db, { key: tutoring.key, answer: "went" }, now);
    expect(r.xp).toBe(90);
    const act = db.select().from(t.activities).where(eq(t.activities.id, r.activityId!)).get()!;
    expect(act).toMatchObject({ name: "Biology", durationMin: 90, activityTypeId: "lesson", source: "inbox" });

    const duty = inbox[2]!;
    const d = answerCalendar(db, { key: duty.key, answer: "went" }, now);
    expect(d.xp).toBe(23); // 90 min × light 0.5 × very easy 0.5: deliberately small
    const exam = answerCalendar(db, { key: inbox[0]!.key, answer: "went" }, now);
    expect(exam.xp).toBe(43); // 255 min, tapered, × 0.25
    expect(skillXp(db, "resilience")).toBe(66);
    expect(calendarInbox(db, now)).toHaveLength(0);
    // Answering twice is harmless.
    expect(() => answerCalendar(db, { key: tutoring.key, answer: "went" }, now)).not.toThrow();
    expect(db.select().from(t.activities).where(eq(t.activities.source, "inbox")).all()).toHaveLength(3);
    expect(calendarInbox(db, now)).toHaveLength(0);
    expect(verify(db)).toEqual([]);
  });

  it("never asks about sessions from before the calendar was set up", () => {
    const db = seededDb();
    importTimetable(db, FILE, bkk(2026, 11, 23, 12));
    expect(calendarInbox(db, bkk(2026, 11, 23, 23)).map((o) => o.title)).toEqual(["Biology"]);
  });

  it("matches a session already logged by hand instead of counting it twice", () => {
    const db = seededDb();
    importTimetable(db, FILE, SETUP);
    const now = bkk(2026, 11, 16, 23);
    createActivity(db, { name: "Bio tutoring", startAt: bkk(2026, 11, 16, 20, 30), durationMin: 85, activityTypeId: "lesson", difficulty: "normal", skills: [{ skillId: "biology", weight: 100 }] }, now);
    const before = skillXp(db, "biology");
    const [bio] = calendarInbox(db, now);
    expect(answerCalendar(db, { key: bio!.key, answer: "went" }, now)).toMatchObject({ matched: true, xp: 0 });
    expect(skillXp(db, "biology")).toBe(before);
  });

  it("school feed: obvious titles map to skills, new ones ask, cancelled ones never ask", () => {
    const db = seededDb();
    storeFeed(db, parseIcs(ICS), bkk(2026, 11, 16, 9));
    expect(suggestSkillForTitle(db, "vex robotics competition")).toBe("robotics");
    expect(suggestSkillForTitle(db, "dt production run")).toBe("design-technology");
    expect(suggestSkillForTitle(db, "maths for competitions y9-y11")).toBe("mathematics");
    expect(suggestSkillForTitle(db, "y11 doeia")).toBeNull();

    const now = bkk(2026, 11, 21, 12);
    const inbox = calendarInbox(db, now);
    expect(inbox.map((o) => [o.title, o.needsSkill])).toEqual([
      ["Y11 DOEIA", true],
      ["Piano Lesson", false],
      ["VEX Robotics Competition", false],
    ]);
    const vex = inbox[2]!;
    expect(answerCalendar(db, { key: vex.key, answer: "went" }, now).xp).toBe(55);
    const piano = db.select().from(t.calendarRules).where(eq(t.calendarRules.titleKey, "piano lesson")).get();
    expect(piano).toMatchObject({ skillId: "piano", activityTypeId: "lesson" });

    const doe = inbox[0]!;
    expect(() => answerCalendar(db, { key: doe.key, answer: "went" }, now)).toThrow(/Pick a skill/);
    answerCalendar(db, { key: doe.key, answer: "went", skillId: "resilience", remember: true }, now);
    expect(db.select().from(t.calendarRules).where(eq(t.calendarRules.titleKey, "y11 doeia")).get()).toMatchObject({ action: "log", skillId: "resilience" });
  });

  it("'never' makes a feed title untracked", () => {
    const db = seededDb();
    storeFeed(db, parseIcs(ICS), bkk(2026, 11, 16, 9));
    const now = bkk(2026, 11, 21, 12);
    const doe = calendarInbox(db, now).find((o) => o.title === "Y11 DOEIA")!;
    answerCalendar(db, { key: doe.key, answer: "never" }, now);
    expect(calendarInbox(db, now).map((o) => o.title)).not.toContain("Y11 DOEIA");
  });
});

describe("feed and Apple Calendar", () => {
  it("accepts webcal links and fetches through an injected fetcher", async () => {
    expect(feedUrl("webcal://calsync.example.com/x.ashx?key=1")).toBe("https://calsync.example.com/x.ashx?key=1");
    expect(() => feedUrl("not a link")).toThrow();
    const db = seededDb();
    expect(await refreshFeed(db)).toMatchObject({ ok: false });
    setSetting(db, "socsFeedUrl", "webcal://calsync.example.com/x");
    const ok = await refreshFeed(db, (async () => new Response(ICS)) as typeof fetch, bkk(2026, 11, 16, 9));
    expect(ok).toEqual({ ok: true, count: 4 });
    const bad = await refreshFeed(db, (async () => new Response("nope", { status: 500 })) as typeof fetch);
    expect(bad).toMatchObject({ ok: false, error: /500/ });
    expect(getSetting(db, "socsLastFetch")).toMatchObject({ count: 4 });
    expect(db.select().from(t.externalEvents).all()).toHaveLength(4); // a failed fetch keeps the last good copy
  });

  it("sends the timetable but not school feed events to Apple Calendar, with a stable hash", () => {
    const db = seededDb();
    importTimetable(db, FILE, SETUP);
    storeFeed(db, parseIcs(ICS), bkk(2026, 11, 16, 9));
    const now = bkk(2026, 11, 16, 9);
    const out = appleOutbox(db, now);
    expect(out.calendarName).toBe("ASCEND");
    expect(out.items.some((i) => i.title === "VEX Robotics Competition")).toBe(false);
    expect(out.items.find((i) => i.title === "English")).toMatchObject({ location: "S223", notes: "Lesson · Week 1 · Added by ASCEND" });
    expect(appleOutbox(db, now).hash).toBe(out.hash);
    flipWeek(db);
    expect(appleOutbox(db, now).hash).not.toBe(out.hash);
  });

  it("builds a week view with breaks marked", () => {
    const db = seededDb();
    importTimetable(db, FILE, SETUP);
    const w = calendarWeek(db, "2026-12-09");
    expect(w.monday).toBe("2026-12-07");
    expect(w.week).toBe(2);
    expect(w.days[0]).toEqual({ date: "2026-12-07", break: "School closed", week: null, due: 0 });
    expect(w.days[6]).toEqual({ date: "2026-12-13", break: null, week: 1, due: 0 }); // the Sunday before a Week 1
    expect(w.items.map((i) => i.title)).toContain("Biology");
    expect(w.items.map((i) => i.title)).not.toContain("Economics"); // closed that Monday
  });
});
