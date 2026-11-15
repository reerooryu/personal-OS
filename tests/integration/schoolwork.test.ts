import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { appleOutbox, calendarWeek, importTimetable, occurrences, type TimetableFile } from "@/services/calendar";
import { verify } from "@/services/engine";
import { traitScores } from "@/services/queries";
import {
  addHomework,
  addTest,
  completeHomework,
  dueSoon,
  importSchoolworkFromFile,
  lessonChoices,
  recordTestResult,
  reopenHomework,
  setNoResult,
  testsAwaitingResult,
} from "@/services/schoolwork";
import { bkk, seededDb, skillXp } from "./helpers";

/** Ryu's real Week 1 Monday, Wednesday and Friday maths/physics/geography lessons. */
const FILE: TimetableFile = {
  weekAnchor: "2026-11-16",
  slots: [
    { title: "Physics", location: "A213", kind: "lesson", day: "Mon", week: 1, start: "08:50", end: "09:45", skill: "physics" },
    { title: "Mathematics", location: "A404", kind: "lesson", day: "Mon", week: 1, start: "10:05", end: "11:00", skill: "mathematics" },
    { title: "Mathematics", location: "A404", kind: "lesson", day: "Wed", week: 1, start: "07:50", end: "09:45", skill: "mathematics" },
    { title: "Geography", location: "S314", kind: "lesson", day: "Fri", week: 1, start: "07:50", end: "09:45", skill: "geography" },
    { title: "Mathematics", location: "A404", kind: "lesson", day: "Mon", week: 2, start: "10:05", end: "11:00", skill: "mathematics" },
  ],
};

const NOW = bkk(2026, 11, 16, 1, 14); // Monday 16 Nov, just after 1 am

function setup() {
  const db = seededDb();
  importTimetable(db, FILE, bkk(2026, 11, 1));
  return db;
}

describe("homework", () => {
  it("offers the subject's next lessons as due dates", () => {
    const db = setup();
    const maths = lessonChoices(db, NOW).mathematics!;
    expect(maths.slice(0, 3).map((l) => l.startAt)).toEqual([bkk(2026, 11, 16, 10, 5), bkk(2026, 11, 18, 7, 50), bkk(2026, 11, 23, 10, 5)]);
    expect(maths[0]!.location).toBe("A404");
    expect(lessonChoices(db, bkk(2026, 11, 16, 11)).mathematics![0]!.startAt).toBe(bkk(2026, 11, 18, 7, 50));
  });

  it("the two real examples: due next Maths lesson, and a custom 16:00 time", () => {
    const db = setup();
    const ws = addHomework(db, { title: "Math Worksheet", skillId: "mathematics", dueAt: lessonChoices(db, NOW).mathematics![0]!.startAt, description: "mark using the markscheme" }, NOW);
    addHomework(db, { title: "Physics MCQ", skillId: "physics", dueAt: bkk(2026, 11, 16, 16) }, NOW);
    const soon = dueSoon(db, NOW);
    expect(soon.upcoming.map((h) => [h.title, h.skillName])).toEqual([
      ["Math Worksheet", "Mathematics"],
      ["Physics MCQ", "Physics"],
    ]);
    expect(calendarWeek(db, "2026-11-16").days[0]!.due).toBe(2);

    // Ticked off at 9 am after 40 minutes: logged as Maths study, on time.
    const r = completeHomework(db, ws.id, 40, bkk(2026, 11, 16, 9));
    expect(r.xp).toBe(40);
    expect(skillXp(db, "mathematics")).toBe(40);
    expect(db.select().from(t.activities).where(eq(t.activities.id, r.activityId!)).get()).toMatchObject({ name: "Math Worksheet", activityTypeId: "study", source: "task", durationMin: 40 });
    expect(dueSoon(db, bkk(2026, 11, 16, 9)).upcoming.map((h) => h.title)).toEqual(["Physics MCQ"]);
    expect(calendarWeek(db, "2026-11-16").days[0]!.due).toBe(1);
  });

  it("overdue homework shows until done; reopening can remove the logged time", () => {
    const db = setup();
    const h = addHomework(db, { title: "Physics MCQ", skillId: "physics", dueAt: bkk(2026, 11, 16, 16) }, NOW);
    expect(dueSoon(db, bkk(2026, 11, 17, 8)).overdue.map((x) => x.title)).toEqual(["Physics MCQ"]);
    completeHomework(db, h.id, 30, bkk(2026, 11, 17, 8));
    expect(dueSoon(db, bkk(2026, 11, 17, 9)).overdue).toEqual([]);
    reopenHomework(db, h.id, true);
    expect(skillXp(db, "physics")).toBe(0);
    completeHomework(db, h.id, null, bkk(2026, 11, 17, 10)); // just tick, no log
    expect(skillXp(db, "physics")).toBe(0);
    expect(verify(db)).toEqual([]);
  });

  it("feeds Time Management: share done on time, once there are three", () => {
    const db = setup();
    const now = bkk(2026, 11, 20, 20);
    const due = (d: number) => bkk(2026, 11, d, 16);
    const a = addHomework(db, { title: "A", skillId: "physics", dueAt: due(16) }, NOW);
    const b = addHomework(db, { title: "B", skillId: "physics", dueAt: due(17) }, NOW);
    expect(traitScores(db, now).time_management).toBeNull();
    addHomework(db, { title: "C", skillId: "physics", dueAt: due(18) }, NOW); // never done: late
    addHomework(db, { title: "D", skillId: "physics", dueAt: due(19) }, NOW);
    completeHomework(db, a.id, null, due(16) - 3_600_000); // on time
    completeHomework(db, b.id, null, due(17) + 3_600_000); // late
    // A on time; B, C, D late or not done.
    expect(traitScores(db, now).time_management).toBe(25);
  });
});

describe("tests", () => {
  it("the two real tests sit in place of their lessons, on the calendar and the iPhone", () => {
    const db = setup();
    addTest(db, { skillId: "mathematics", startAt: lessonChoices(db, NOW).mathematics![1]!.startAt, durationMin: 115 }, NOW);
    addTest(db, { skillId: "geography", startAt: lessonChoices(db, NOW).geography![0]!.startAt, durationMin: 115 }, NOW);
    const wed = occurrences(db, "2026-11-18", "2026-11-18");
    expect(wed.map((o) => [o.title, o.kind, o.location])).toEqual([["Mathematics test", "test", "A404"]]);
    const fri = occurrences(db, "2026-11-20", "2026-11-20");
    expect(fri.map((o) => o.title)).toEqual(["Geography test"]);
    expect(appleOutbox(db, NOW).items.map((i) => i.title)).toContain("Mathematics test");
    expect(dueSoon(db, NOW).tests.map((x) => x.title)).toEqual(["Mathematics test", "Geography test"]);
  });

  it("asks for the result afterwards and records it as a test percentage", () => {
    const db = setup();
    const x = addTest(db, { skillId: "mathematics", kind: "test", startAt: bkk(2026, 11, 18, 7, 50), durationMin: 115 }, NOW);
    expect(testsAwaitingResult(db, bkk(2026, 11, 18, 9))).toHaveLength(0); // still sitting it
    expect(testsAwaitingResult(db, bkk(2026, 11, 18, 10)).map((r) => r.title)).toEqual(["Mathematics test"]);
    expect(() => recordTestResult(db, x.id, 41, 40)).toThrow();
    const a = recordTestResult(db, x.id, 38, 40);
    expect(a).toMatchObject({ measurementTypeId: "mathematics-exam", rawValue: 95, method: "timed_test", assessedAt: bkk(2026, 11, 18, 7, 50) });
    expect(testsAwaitingResult(db, bkk(2026, 11, 18, 10))).toHaveLength(0);
    const y = addTest(db, { skillId: "geography", startAt: bkk(2026, 11, 20, 7, 50), durationMin: 115 }, NOW);
    setNoResult(db, y.id);
    expect(testsAwaitingResult(db, bkk(2026, 11, 21, 10))).toHaveLength(0);
  });

  it("adds homework and tests listed in the private file once, and never again", () => {
    const db = setup();
    const toUtc = (s: string) => {
      const [d, tm] = s.split(" ");
      const [y, m, day] = d!.split("-").map(Number);
      const [h, mi] = tm!.split(":").map(Number);
      return bkk(y!, m!, day!, h!, mi!);
    };
    const raw = {
      homework: [{ title: "Math Worksheet", subject: "mathematics", due: "2026-11-16 10:05", description: "mark using the markscheme" }],
      tests: [{ subject: "geography", date: "2026-11-20 07:50", durationMin: 115 }],
    };
    expect(importSchoolworkFromFile(db, raw, toUtc, NOW)).toBe(2);
    expect(importSchoolworkFromFile(db, raw, toUtc, NOW)).toBe(0);
    expect(db.select().from(t.tests).get()).toMatchObject({ title: "Geography test", startAt: bkk(2026, 11, 20, 7, 50) });
  });
});
