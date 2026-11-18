import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { verify } from "@/services/engine";
import {
  answerCalendar,
  appleOutbox,
  calendarInbox,
  deleteEvent,
  editableEvents,
  importTimetable,
  occurrences,
  saveEvent,
  type EventInput,
  type TimetableFile,
} from "@/services/calendar";
import { setSetting } from "@/services/settings";
import { bkk, seededDb, skillXp } from "./helpers";

const H = 3_600_000;
const SETUP = bkk(2026, 11, 1);

/** The example from the brief: a VEX session at school, then on at a friend's room. */
const MEGA_VEX: EventInput = {
  title: "Mega VEX session",
  kind: "meetup",
  date: "2026-11-22",
  parts: [
    { start: "15:00", end: "18:00", location: "School" },
    { start: "18:00", end: "19:30", location: "Friend's room (condo)" },
  ],
  skillId: "robotics",
};

const FILE: TimetableFile = {
  weekAnchor: "2026-11-16",
  slots: [{ title: "English", location: "E1", kind: "lesson", day: "mon", week: 1, start: "07:50", end: "08:50", skill: "english" }],
  events: [{ title: "Military Training Exam", location: null, date: "2026-11-28", start: "07:45", end: "12:00", skill: "resilience", xp: "small" }],
  breaks: [],
};

function fresh() {
  const db = seededDb();
  setSetting(db, "calendarSince", SETUP);
  return db;
}

describe("Ryu's own events", () => {
  it("saves a two-part event as linked parts on the calendar", () => {
    const db = fresh();
    const { groupId, parts } = saveEvent(db, null, MEGA_VEX);
    expect(parts).toBe(2);
    const occ = occurrences(db, "2026-11-22", "2026-11-22").filter((o) => o.source === "event");
    expect(occ.map((o) => [o.location, o.startAt, o.endAt])).toEqual([
      ["School", bkk(2026, 11, 22, 15), bkk(2026, 11, 22, 18)],
      ["Friend's room (condo)", bkk(2026, 11, 22, 18), bkk(2026, 11, 22, 19, 30)],
    ]);
    expect(occ.every((o) => o.groupId === groupId && o.mine && o.category === "meetup" && o.xp === "normal")).toBe(true);
    // The dialog can load it back exactly.
    expect(editableEvents(db, "2026-11-22", "2026-11-22")[groupId]).toMatchObject({
      title: "Mega VEX session",
      date: "2026-11-22",
      parts: [
        { start: "15:00", end: "18:00", location: "School" },
        { start: "18:00", end: "19:30", location: "Friend's room (condo)" },
      ],
    });
  });

  it("asks 'Did you go?' for each part afterwards, and logs it against the skill", () => {
    const db = fresh();
    saveEvent(db, null, MEGA_VEX);
    const after = bkk(2026, 11, 22, 20);
    const inbox = calendarInbox(db, after).filter((o) => o.source === "event");
    expect(inbox).toHaveLength(2);
    const before = skillXp(db, "robotics");
    for (const o of inbox) answerCalendar(db, { key: o.key, answer: "went" }, after);
    expect(skillXp(db, "robotics")).toBeGreaterThan(before);
    const acts = db.select().from(t.activities).all().filter((a) => a.name === "Mega VEX session");
    expect(acts.map((a) => a.durationMin).sort()).toEqual([180, 90].sort());
    expect(verify(db)).toEqual([]);
  });

  it("a competition with a skill logs as a competition, capped at eight hours", () => {
    const db = fresh();
    saveEvent(db, null, { title: "VEX competition", kind: "competition", date: "2026-11-22", parts: [{ start: "07:00", end: "18:00", location: "Bangkok" }], skillId: "robotics" });
    const after = bkk(2026, 11, 22, 19);
    const [o] = calendarInbox(db, after);
    expect(o).toMatchObject({ activityTypeId: "competition" });
    const r = answerCalendar(db, { key: o!.key, answer: "went" }, after);
    const act = db.select().from(t.activities).where(eq(t.activities.id, r.activityId!)).get()!;
    expect(act).toMatchObject({ activityTypeId: "competition", durationMin: 480 });
  });

  it("friends' plans and events without a skill are on the calendar but never asked about", () => {
    const db = fresh();
    saveEvent(db, null, { title: "Dinner with Ken", kind: "friends", date: "2026-11-20", parts: [{ start: "18:00", end: "20:00" }], skillId: "robotics" });
    saveEvent(db, null, { title: "Prize-giving", kind: "event", date: "2026-11-20", parts: [{ start: "09:00", end: "10:00" }] });
    const occ = occurrences(db, "2026-11-20", "2026-11-20").filter((o) => o.source === "event");
    expect(occ).toHaveLength(2);
    expect(occ.every((o) => o.xp === "none" && o.skillId === null)).toBe(true);
    expect(calendarInbox(db, bkk(2026, 11, 21, 9)).filter((o) => o.source === "event")).toEqual([]);
  });

  it("all-day events cover the day and are never asked about", () => {
    const db = fresh();
    saveEvent(db, null, { title: "VEX tournament", kind: "competition", date: "2026-11-22", allDay: true, parts: [{ start: "00:00", end: "00:00", location: "Bangkok" }], skillId: "robotics" });
    const [o] = occurrences(db, "2026-11-22", "2026-11-22").filter((x) => x.source === "event");
    expect(o).toMatchObject({ allDay: true, startAt: bkk(2026, 11, 22, 0), endAt: bkk(2026, 11, 23, 0), xp: "none" });
    expect(calendarInbox(db, bkk(2026, 11, 23, 9))).toEqual([]);
    expect(appleOutbox(db, bkk(2026, 11, 18)).items.find((i) => i.uid === o!.key)).toMatchObject({ allDay: true });
  });

  it("editing replaces all parts, deleting removes them, and both go to the iPhone", () => {
    const db = fresh();
    const now = bkk(2026, 11, 18);
    const { groupId } = saveEvent(db, null, MEGA_VEX);
    const h1 = appleOutbox(db, now).hash;
    saveEvent(db, groupId, { ...MEGA_VEX, parts: [{ start: "15:00", end: "19:30", location: "School" }], notes: "Bring the battery charger" });
    const occ = occurrences(db, "2026-11-22", "2026-11-22").filter((o) => o.source === "event");
    expect(occ).toHaveLength(1);
    const out = appleOutbox(db, now);
    expect(out.hash).not.toBe(h1);
    expect(out.items.find((i) => i.uid === occ[0]!.key)?.notes).toContain("Bring the battery charger");
    deleteEvent(db, groupId);
    expect(occurrences(db, "2026-11-22", "2026-11-22").filter((o) => o.source === "event")).toEqual([]);
  });

  it("re-importing the timetable file keeps Ryu's events, and file events can't be edited here", () => {
    const db = fresh();
    importTimetable(db, FILE, SETUP);
    saveEvent(db, null, MEGA_VEX);
    importTimetable(db, { ...FILE, events: [] }, SETUP);
    const left = db.select().from(t.calendarEvents).all();
    expect(left.map((e) => e.title)).toEqual(["Mega VEX session", "Mega VEX session"]);
    importTimetable(db, FILE, SETUP);
    const exam = db.select().from(t.calendarEvents).all().find((e) => e.origin === "file")!;
    expect(() => saveEvent(db, exam.groupId ?? exam.id, MEGA_VEX)).toThrow();
    expect(() => deleteEvent(db, exam.groupId ?? exam.id)).toThrow();
  });

  it("rejects parts that end before they start or run out of order", () => {
    const db = fresh();
    expect(() => saveEvent(db, null, { ...MEGA_VEX, parts: [{ start: "18:00", end: "15:00" }] })).toThrow(/end after/);
    expect(() => saveEvent(db, null, { ...MEGA_VEX, parts: [{ start: "15:00", end: "18:00" }, { start: "16:00", end: "19:00" }] })).toThrow(/in order/);
    expect(() => saveEvent(db, null, { ...MEGA_VEX, title: " " })).toThrow();
    expect(() => saveEvent(db, null, { ...MEGA_VEX, skillId: "resilience-trait-nope" })).toThrow();
  });
});
