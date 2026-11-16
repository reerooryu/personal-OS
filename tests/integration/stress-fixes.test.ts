/** Regression tests for bugs found by the stress pass on 16 Nov 2026. */
import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { rotationWeek } from "@/domain/calendar";
import { answerCalendar, importTimetable, occurrences, setCalendarRule, storeFeed } from "@/services/calendar";
import { addHomework, addTest } from "@/services/schoolwork";
import { createSkill, deleteSkill } from "@/services/skills";
import { bkk, seededDb } from "./helpers";

const NOW = bkk(2026, 11, 16, 23);
const FILE = {
  weekAnchor: "2026-11-16",
  slots: [{ title: "Mathematics", kind: "lesson" as const, day: "Mon", week: 1 as const, start: "10:05", end: "11:00", skill: "mathematics" }],
};

describe("stress pass fixes", () => {
  it("a lesson can't be logged through 'Did you go?'", () => {
    const db = seededDb();
    importTimetable(db, FILE, bkk(2026, 11, 1));
    const lesson = occurrences(db, "2026-11-16", "2026-11-16")[0]!;
    expect(() => answerCalendar(db, { key: lesson.key, answer: "went" }, NOW)).toThrow(/aren't logged/);
  });

  it("a cancelled session can't be logged", () => {
    const db = seededDb();
    storeFeed(db, [{ uid: "x", title: "VEX Robotics Competition", titleKey: "vex robotics competition", location: null, category: null, startAt: bkk(2026, 11, 16, 15), endAt: bkk(2026, 11, 16, 16), allDay: false, cancelled: true }], bkk(2026, 11, 1));
    expect(() => answerCalendar(db, { key: "feed:x", answer: "went" }, NOW)).toThrow(/cancelled/);
  });

  it("an untracked club can't be logged, but can still be marked never", () => {
    const db = seededDb();
    storeFeed(db, [{ uid: "y", title: "Assembly", titleKey: "assembly", location: null, category: null, startAt: bkk(2026, 11, 16, 15), endAt: bkk(2026, 11, 16, 16), allDay: false, cancelled: false }], bkk(2026, 11, 1));
    setCalendarRule(db, "assembly", { action: "ignore" });
    expect(() => answerCalendar(db, { key: "feed:y", answer: "went" }, NOW)).toThrow();
  });

  it("the week anchor can be any day of a Week 1 school week", () => {
    for (const anchor of ["2026-11-15", "2026-11-16", "2026-11-18", "2026-11-20", "2026-11-21"]) {
      expect([rotationWeek("2026-11-16", anchor), rotationWeek("2026-11-23", anchor), rotationWeek("2026-11-22", anchor)]).toEqual([1, 2, 2]);
    }
  });

  it("a skill used by homework, a test or the timetable can't be deleted, and its rules go with it", () => {
    for (const use of ["homework", "test", "timetable"] as const) {
      const db = seededDb();
      const s = createSkill(db, { name: "Latin", attributeId: "academics" });
      if (use === "homework") addHomework(db, { title: "x", skillId: s.id, dueAt: NOW }, NOW);
      if (use === "test") addTest(db, { skillId: s.id, startAt: NOW }, NOW);
      if (use === "timetable") importTimetable(db, { weekAnchor: "2026-11-16", slots: [{ title: "Latin", kind: "tutoring", day: "Mon", week: null, start: "20:30", end: "22:00", skill: s.id }] }, NOW);
      expect(() => deleteSkill(db, s.id)).toThrow(/Archive it instead/);
    }
    const db = seededDb();
    const s = createSkill(db, { name: "Latin", attributeId: "academics" });
    setCalendarRule(db, "latin club", { action: "log", skillId: s.id });
    deleteSkill(db, s.id);
    expect(db.select().from(t.calendarRules).all().some((r) => r.titleKey === "latin club")).toBe(false);
  });
});
