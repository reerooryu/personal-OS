import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { createActivity } from "@/services/activities";
import { runDataFixes } from "@/services/data-fixes";
import { verify } from "@/services/engine";
import { questBoard, skillSummaries, xpTotals } from "@/services/queries";
import { createAssessment } from "@/services/records";
import { addHomework, addTest, completeHomework, deleteTest, updateTest } from "@/services/schoolwork";
import { getSetting } from "@/services/settings";
import { createSkill, mergeSkill } from "@/services/skills";
import { withRevision } from "@/services/views";
import { bkk, seededDb } from "./helpers";

const NOW = bkk(2026, 11, 16, 18); // Monday evening
const H = 3_600_000;
const study = (skillId: string, at: number, minutes: number, type = "study") => ({ name: "Revision", startAt: at, durationMin: minutes, activityTypeId: type, difficulty: "normal" as const, skills: [{ skillId, weight: 100 }] });
const grade = (db: ReturnType<typeof seededDb>, skillId: string, label: string) =>
  createAssessment(db, { skillId, measurementTypeId: `${skillId}-gcse`, assessedAt: NOW - 30 * 24 * H, rawLabel: label, method: "school_report" });
const pct = (db: ReturnType<typeof seededDb>, skillId: string, value: number, daysAgo: number) =>
  createAssessment(db, { skillId, measurementTypeId: `${skillId}-exam`, assessedAt: NOW - daysAgo * 24 * H, rawValue: value, method: "timed_test" });
const questOf = (db: ReturnType<typeof seededDb>, testId: string) => {
  const x = db.select().from(t.tests).where(eq(t.tests.id, testId)).get()!;
  return x.revisionQuestId ? db.select().from(t.quests).where(eq(t.quests.id, x.revisionQuestId)).get() : undefined;
};

describe("revision quests", () => {
  it("a test gets a revision quest sized from the subject's grade", () => {
    const db = seededDb();
    grade(db, "mathematics", "9");
    const x = addTest(db, { skillId: "mathematics", startAt: bkk(2026, 11, 20, 7, 50), durationMin: 115 }, NOW);
    const q = questOf(db, x.id)!;
    expect(q).toMatchObject({ title: "Revise: Mathematics test", kind: "long_term", origin: "generated", endAt: bkk(2026, 11, 20, 7, 50), rewardXp: 60 });
    expect(q.description).toMatch(/^Mathematics is at S/);
    const reqs = db.select().from(t.questRequirements).where(eq(t.questRequirements.questId, q.id)).all();
    expect(reqs.map((r) => [r.type, r.target])).toEqual([["duration", 60], ["distinct_days", 2]]);
  });

  it("a slipping subject gets a bigger plan than a steady one", () => {
    const db = seededDb();
    grade(db, "physics", "8");
    pct(db, "physics", 90, 40);
    pct(db, "physics", 88, 20);
    pct(db, "physics", 70, 5);
    grade(db, "chemistry", "8");
    pct(db, "chemistry", 88, 20);
    pct(db, "chemistry", 90, 5);
    const p = addTest(db, { skillId: "physics", startAt: bkk(2026, 11, 26, 10, 5) }, NOW);
    const c = addTest(db, { skillId: "chemistry", startAt: bkk(2026, 11, 26, 11, 5) }, NOW);
    expect(questOf(db, p.id)!.rewardXp).toBeGreaterThan(questOf(db, c.id)!.rewardXp);
    expect(questOf(db, p.id)!.description).toContain("slipping (89% → 70%)");
  });

  it("study and homework time in the subject fill it, other subjects and lessons don't", () => {
    const db = seededDb();
    grade(db, "mathematics", "9");
    const x = addTest(db, { skillId: "mathematics", startAt: bkk(2026, 11, 20, 7, 50), durationMin: 115 }, NOW);
    createActivity(db, study("physics", NOW + 1 * H, 60), NOW + 2 * H);
    createActivity(db, study("mathematics", NOW + 1 * H, 60, "lesson"), NOW + 2 * H);
    createActivity(db, study("mathematics", NOW + 1 * H, 30), NOW + 2 * H);
    const h = addHomework(db, { title: "Worksheet", skillId: "mathematics", dueAt: bkk(2026, 11, 18, 10) }, NOW);
    let [card] = withRevision(db, [db.select().from(t.tests).where(eq(t.tests.id, x.id)).get()!], NOW + 3 * H);
    expect(card!.revision).toMatchObject({ state: "active", minutes: { done: 30, target: 60 }, days: { done: 1, target: 2 } });
    const before = xpTotals(db).character;
    completeHomework(db, h.id, 30, bkk(2026, 11, 17, 19)); // the next day: second day, total 60
    [card] = withRevision(db, [db.select().from(t.tests).where(eq(t.tests.id, x.id)).get()!], bkk(2026, 11, 17, 20));
    expect(card!.revision!.state).toBe("completed");
    expect(xpTotals(db).character - before).toBe(30 + 60); // the session's XP plus the quest's 60
    expect(verify(db)).toEqual([]);
  });

  it("editing the test re-plans it, deleting removes it, and a completed one stays", () => {
    const db = seededDb();
    const x = addTest(db, { skillId: "biology", startAt: bkk(2026, 11, 27, 8, 50) }, NOW);
    const first = questOf(db, x.id)!.id;
    updateTest(db, x.id, { skillId: "biology", kind: "exam", startAt: bkk(2026, 11, 27, 8, 50), durationMin: 55 }, NOW);
    const second = questOf(db, x.id)!;
    expect(second.id).not.toBe(first);
    expect(second.title).toBe("Revise: Biology exam");
    expect(db.select().from(t.quests).where(eq(t.quests.id, first)).get()).toBeUndefined();
    deleteTest(db, x.id);
    expect(db.select().from(t.quests).where(eq(t.quests.id, second.id)).get()).toBeUndefined();

    const y = addTest(db, { skillId: "biology", kind: "quiz", startAt: bkk(2026, 11, 18, 14) }, NOW);
    createActivity(db, study("biology", NOW + H, 30), NOW + 2 * H);
    createActivity(db, study("biology", NOW + 24 * H, 30), NOW + 25 * H); // a quiz plan here: 60 min over 2 days
    const done = questOf(db, y.id)!;
    expect(questBoard(db, NOW + 25 * H).find((c) => c.id === done.id)!.state).toBe("completed");
    deleteTest(db, y.id);
    expect(db.select().from(t.quests).where(eq(t.quests.id, done.id)).get()).toBeDefined(); // the reward stays earned
  });

  it("a test already started or past gets no quest", () => {
    const db = seededDb();
    const x = addTest(db, { skillId: "biology", startAt: NOW - H }, NOW);
    expect(questOf(db, x.id)).toBeUndefined();
  });
});

describe("folding Music Theory into Piano", () => {
  it("merges weights, moves every link, keeps the totals, and leaves the books balanced", () => {
    const db = seededDb();
    const theory = createSkill(db, { name: "Old Theory", attributeId: "creative", parentId: "piano" });
    createActivity(db, { ...study("piano", NOW - 2 * H, 40, "practice"), skills: [{ skillId: "piano", weight: 60 }, { skillId: theory.id, weight: 40 }] }, NOW);
    createActivity(db, study(theory.id, NOW - H, 20), NOW);
    addHomework(db, { title: "Theory sheet", skillId: theory.id, dueAt: NOW + 24 * H }, NOW);
    const before = xpTotals(db).character;
    const pianoBefore = skillSummaries(db, NOW).find((s) => s.id === "piano")!.xp;
    mergeSkill(db, theory.id, "piano");
    expect(db.select().from(t.skills).where(eq(t.skills.id, theory.id)).get()).toBeUndefined();
    expect(xpTotals(db).character).toBe(before);
    const piano = skillSummaries(db, NOW).find((s) => s.id === "piano")!;
    expect(piano.xp).toBe(pianoBefore);
    expect(piano.ownXp).toBe(piano.xp);
    expect(db.select().from(t.activitySkills).where(eq(t.activitySkills.skillId, "piano")).all().map((r) => r.weight)).toContain(100);
    expect(db.select().from(t.homework).get()!.skillId).toBe("piano");
    expect(db.select().from(t.skills).where(eq(t.skills.id, "piano")).get()!.aliases).toContain("old theory");
    expect(verify(db)).toEqual([]);
  });

  it("the startup fix runs once and is safe on a database without Music Theory", () => {
    const db = seededDb();
    expect(runDataFixes(db, NOW)).toEqual(["2026-11-fold-music-theory", "2026-11-revision-quests"]);
    expect(runDataFixes(db, NOW)).toEqual([]);
    expect(getSetting(db, "dataFixes")).toHaveLength(2);
    expect(db.select().from(t.activityTemplates).where(eq(t.activityTemplates.id, "tpl-theory")).get()).toBeUndefined();
  });
});
