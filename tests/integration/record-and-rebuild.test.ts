import { eq } from "drizzle-orm";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { DIFFICULTIES } from "@/domain/types";
import { clearSampleData, seedDatabase } from "@/seed/seed";
import { loadStartingRecord, type StartingRecord } from "@/seed/starting-record";
import { createActivity, deleteActivity, restoreActivity, updateActivity } from "@/services/activities";
import { exportData, importData } from "@/services/data";
import { verify } from "@/services/engine";
import { attributeSummaries, characterSummary, medalCase, skillSummaries, xpTotals } from "@/services/queries";
import { awardMedal, createAssessment, deleteAssessment, removeMedalAward, setMilestone } from "@/services/records";
import { NOW, bkk, characterXp, freshDb, piano, seededDb } from "./helpers";

const privateRecord = loadStartingRecord(path.join(process.cwd(), "private", "starting-record.json"));
const exampleRecord = loadStartingRecord(path.join(process.cwd(), "src", "seed", "starting-record.example.json"))!;

describe.skipIf(!privateRecord)("Ryu's starting record", () => {
  const record = privateRecord as StartingRecord;

  it("starts at level 12 with 19,000 XP from 14 medals", () => {
    const db = freshDb();
    seedDatabase(db, { startingRecord: record, now: NOW });
    const c = characterSummary(db, NOW);
    expect(c.xp).toBe(19000);
    expect(c.level).toMatchObject({ level: 12, intoLevel: 1084, levelSize: 4157 });
    expect(medalCase(db)).toHaveLength(14);
    expect(verify(db)).toEqual([]);
  });

  it("gives the expected skill levels and grades", () => {
    const db = freshDb();
    seedDatabase(db, { startingRecord: record, now: NOW });
    const s = new Map(skillSummaries(db, NOW).map((x) => [x.id, x]));
    expect(s.get("robotics")).toMatchObject({ xp: 10750 });
    expect(s.get("robotics")!.level.level).toBe(12);
    expect(s.get("programming")!.level.level).toBe(8);
    expect(s.get("piano")).toMatchObject({ xp: 2500, proficiency: 63, grade: "C" });
    expect(s.get("piano")!.level.level).toBe(7);
    expect(s.has("music-theory")).toBe(false); // folded into Piano on 17 Nov 2026: the theory medal's 500 XP is in Piano's 2500
    expect(s.get("mathematics")).toMatchObject({ xp: 1592, grade: "S" });
    expect(s.get("mathematics")!.level.level).toBe(6);
    expect(s.get("english")).toMatchObject({ proficiency: 95, grade: "S" });
    expect(s.get("biology")).toMatchObject({ proficiency: 80, grade: "A" });
    expect(s.get("design-technology")).toMatchObject({ proficiency: 80, grade: "A" });
    expect(s.get("volleyball")).toMatchObject({ proficiency: 0, grade: "F" });
    expect(s.get("geography")).toMatchObject({ proficiency: 88, grade: "A" }); // the 59.5% test is not representative
    const academics = attributeSummaries(db, NOW).find((a) => a.id === "academics")!;
    // 500 XP per Perfect Term over 11 skills: 45 each, with the 5 leftover points going to the first five skills.
    expect(academics.skills.map((k) => k.ownXp).filter((x) => x !== 1592).every((x) => x === 90 || x === 92)).toBe(true);
  });
});

describe("starting record import", () => {
  it("imports the example record", () => {
    const db = freshDb();
    seedDatabase(db, { startingRecord: exampleRecord, now: NOW });
    expect(characterSummary(db, NOW)).toMatchObject({ name: "Alex", xp: 500 });
    expect(skillSummaries(db, NOW).find((s) => s.id === "piano")).toMatchObject({ proficiency: 33, grade: "E" });
  });

  it("returns the existing award when the same occasion is submitted twice", () => {
    const db = seededDb();
    const input = { medalId: "vex-award", occasionKey: "x", occasion: "Test", awardedAt: NOW };
    const a = awardMedal(db, input);
    const b = awardMedal(db, input);
    expect(b.id).toBe(a.id);
    expect(characterXp(db)).toBe(500);
    removeMedalAward(db, a.id);
    expect(characterXp(db)).toBe(0);
    expect(verify(db)).toEqual([]);
  });
});

describe("sample data", () => {
  it("is badged, counts like real data, and clears completely", () => {
    const db = freshDb();
    seedDatabase(db, { sample: true, startingRecord: exampleRecord, now: NOW });
    const sample = db.select().from(t.activities).where(eq(t.activities.isSample, true)).all();
    expect(sample.length).toBeGreaterThan(20);
    expect(characterXp(db)).toBeGreaterThan(500);
    expect(verify(db)).toEqual([]);
    clearSampleData(db);
    expect(db.select().from(t.activities).all()).toHaveLength(0);
    expect(characterXp(db)).toBe(500);
    expect(db.select().from(t.questCompletions).all()).toHaveLength(0);
    expect(verify(db)).toEqual([]);
  });
});

describe("export and import", () => {
  it("round-trips to identical totals", () => {
    const db = freshDb();
    seedDatabase(db, { sample: true, startingRecord: exampleRecord, now: NOW });
    const edited = db.select().from(t.activities).all()[0]!;
    db.update(t.journalEntries).set({ body: "Edited by hand", userEdited: true }).where(eq(t.journalEntries.activityId, edited.id)).run();
    const file = JSON.parse(JSON.stringify(exportData(db, NOW)));
    const copy = freshDb();
    importData(copy, file);
    const a = xpTotals(db);
    const b = xpTotals(copy);
    expect(b.character).toBe(a.character);
    expect([...b.bySkill].sort()).toEqual([...a.bySkill].sort());
    expect(copy.select().from(t.questCompletions).all().length).toBe(db.select().from(t.questCompletions).all().length);
    expect(copy.select().from(t.achievementUnlocks).all().length).toBe(db.select().from(t.achievementUnlocks).all().length);
    expect(copy.select().from(t.journalEntries).where(eq(t.journalEntries.activityId, edited.id)).get()?.body).toBe("Edited by hand");
    expect(verify(copy)).toEqual([]);
    expect(() => importData(copy, file)).toThrow(/empty database/);
  });
});

describe("rebuild invariant", () => {
  it("survives 200 random operations with every derived record still matching its sources", () => {
    const db = seededDb();
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
    const skills = ["piano", "mathematics", "physics", "volleyball", "gym", "robotics", "programming"];
    const live: string[] = [];
    const dead: string[] = [];
    const assessments: string[] = [];
    const start = bkk(2026, 10, 1);

    for (let i = 0; i < 200; i++) {
      const op = rand();
      const at = start + Math.floor(rand() * 45 * 24) * 3_600_000;
      if (op < 0.45 || live.length === 0) {
        const s1 = pick(skills);
        const s2 = pick(skills.filter((s) => s !== s1));
        const split = rand() < 0.3;
        const r = createActivity(
          db,
          {
            ...piano(5 + Math.floor(rand() * 200), at, { confirmLong: true }),
            name: `${s1} session`,
            difficulty: pick(DIFFICULTIES),
            activityTypeId: pick(["practice", "study", "training", "competition", "light"]),
            skills: split ? [{ skillId: s1, weight: 60 }, { skillId: s2, weight: 40 }] : [{ skillId: s1, weight: 100 }],
          },
          NOW,
        );
        live.push(r.activity.id);
      } else if (op < 0.65) {
        updateActivity(db, pick(live), { durationMin: 5 + Math.floor(rand() * 200), startAt: rand() < 0.5 ? at : undefined, difficulty: pick(DIFFICULTIES) }, NOW);
      } else if (op < 0.78) {
        const id = live.splice(Math.floor(rand() * live.length), 1)[0]!;
        deleteActivity(db, id, NOW);
        dead.push(id);
      } else if (op < 0.85 && dead.length) {
        const id = dead.splice(Math.floor(rand() * dead.length), 1)[0]!;
        restoreActivity(db, id);
        live.push(id);
      } else if (op < 0.93) {
        const a = createAssessment(db, {
          skillId: "volleyball",
          measurementTypeId: "volleyball-rubric",
          assessedAt: at,
          rawLabel: pick(["Beginner", "Developing", "Competent", "Advanced"]),
          method: "self_assessment",
        });
        assessments.push(a.id);
      } else if (op < 0.96 && assessments.length) {
        deleteAssessment(db, assessments.splice(Math.floor(rand() * assessments.length), 1)[0]!, NOW);
      } else {
        setMilestone(db, "volleyball-second-team:v1:selected", "once", rand() < 0.7, at);
      }
    }
    expect(verify(db)).toEqual([]);
    expect(db.select().from(t.activities).all().length).toBeGreaterThan(50);
  });
});
