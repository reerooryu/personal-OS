import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { createActivity, logTemplate } from "@/services/activities";
import { verify } from "@/services/engine";
import { skillSummaries } from "@/services/queries";
import { createAssessment } from "@/services/records";
import { withReward } from "@/services/rewards";
import { createSkill, deleteSkill, moveSkill, renameSkill, setSkillArchived } from "@/services/skills";
import { activityDetail, questDetail, quickLogOptions, suggestedNow, today, weekInReview } from "@/services/views";
import { NOW, bkk, piano, seededDb, skillXp } from "./helpers";

describe("reward summary", () => {
  it("describes exactly what one log moved", () => {
    const db = seededDb();
    const { reward } = withReward(db, () => createActivity(db, piano(20, bkk(2026, 11, 15, 17)), NOW), (r) => r.activity.id, NOW);
    expect(reward.xp).toBe(30); // 20 + daily quest reward 10
    expect(reward.questsCompleted).toEqual(["Practice piano for 20 minutes"]);
    expect(reward.skills[0]).toMatchObject({ id: "piano", gained: 30 });
    expect(reward.progress.map((p) => p.title)).toEqual(expect.arrayContaining(["Weekly piano: 120 minutes"]));
    expect(reward.progress.find((p) => p.title === "Weekly piano: 120 minutes")?.text).toBe("20 / 120 min");
    expect(reward.achievements).toEqual(expect.arrayContaining(["First Steps", "Quest Complete"]));
  });

  it("reports level-ups and grade-ups", () => {
    const db = seededDb();
    const { reward } = withReward(db, () => createActivity(db, { ...piano(150, bkk(2026, 11, 15, 9)), confirmLong: true }, NOW));
    expect(reward.character.leveledUp).toBe(true);
    const g = withReward(db, () =>
      createAssessment(db, { skillId: "piano", measurementTypeId: "piano-abrsm", assessedAt: bkk(2026, 11, 15, 12), rawLabel: "Grade 6 Merit", method: "examination" }),
    );
    expect(g.reward.gradeUps).toEqual([{ skill: "Piano", from: null, to: "C" }]);
    const g2 = withReward(db, () =>
      createAssessment(db, { skillId: "piano", measurementTypeId: "piano-abrsm", assessedAt: bkk(2026, 11, 15, 13), rawLabel: "Grade 7 Distinction", method: "examination" }),
    );
    expect(g2.reward.gradeUps).toEqual([{ skill: "Piano", from: "C", to: "B" }]);
  });

  it("reports nothing new when the same request is sent twice", () => {
    const db = seededDb();
    const input = piano(20, bkk(2026, 11, 15, 17));
    createActivity(db, input, NOW);
    const { reward } = withReward(db, () => createActivity(db, input, NOW));
    expect(reward.xp).toBe(0);
    expect(reward.questsCompleted).toEqual([]);
  });
});

describe("skill management", () => {
  it("rolls subskill XP up to the parent and keeps history when moved or renamed", () => {
    const db = seededDb();
    const sight = createSkill(db, { name: "Sight-reading", attributeId: "creative", parentId: "piano" });
    createActivity(db, { ...piano(30, bkk(2026, 11, 14, 17)), skills: [{ skillId: sight.id, weight: 100 }] }, NOW);
    const before = new Map(skillSummaries(db, NOW).map((s) => [s.id, s]));
    expect(before.get(sight.id)!.xp).toBe(30);
    // Piano shows its subskill's 30 plus the daily piano quest reward (10) posted to Piano itself.
    expect(before.get("piano")!.xp).toBe(40);
    expect(skillXp(db, "piano")).toBe(10);

    renameSkill(db, sight.id, "Sight reading");
    const journal = db.select().from(t.journalEntries).all()[0]!;
    expect(journal.body).toContain("Sight reading 30");

    moveSkill(db, sight.id, "creative", null);
    const after = new Map(skillSummaries(db, NOW).map((s) => [s.id, s]));
    expect(after.get(sight.id)!.xp).toBe(30);
    expect(after.get("piano")!.xp).toBe(0); // no longer a subskill, so the daily piano quest no longer counts it
    expect(verify(db)).toEqual([]);
  });

  it("re-evaluates quests whose skill filters include subskills after a move", () => {
    const db = seededDb();
    const sight = createSkill(db, { name: "Sight-reading", attributeId: "creative", parentId: "piano" });
    createActivity(db, { ...piano(25, bkk(2026, 11, 14, 17)), skills: [{ skillId: sight.id, weight: 100 }] }, NOW);
    expect(db.select().from(t.questCompletions).where(eq(t.questCompletions.questId, "daily-piano")).all()).toHaveLength(1);
    moveSkill(db, sight.id, "creative", null); // no longer under Piano
    expect(db.select().from(t.questCompletions).where(eq(t.questCompletions.questId, "daily-piano")).all()).toHaveLength(0);
    expect(verify(db)).toEqual([]);
  });

  it("rejects bad moves and deleting skills with history", () => {
    const db = seededDb();
    const sub = createSkill(db, { name: "Scales", attributeId: "creative", parentId: "piano" });
    expect(() => moveSkill(db, "piano", "creative", sub.id)).toThrow(/inside itself/);
    expect(() => moveSkill(db, sub.id, "academics", "piano")).toThrow(/same attribute/);
    expect(() => createSkill(db, { name: "X", attributeId: "personal-development", parentId: "consistency" })).toThrow(/Traits/);
    createActivity(db, { ...piano(10, bkk(2026, 11, 14, 17)), skills: [{ skillId: sub.id, weight: 100 }] }, NOW);
    expect(() => deleteSkill(db, sub.id)).toThrow(/Archive/);
    setSkillArchived(db, sub.id, true);
    expect(skillSummaries(db, NOW).find((s) => s.id === sub.id)).toMatchObject({ archived: true, xp: 10 });
    const empty = createSkill(db, { name: "Empty", attributeId: "athletics" });
    deleteSkill(db, empty.id);
    expect(skillSummaries(db, NOW).find((s) => s.id === empty.id)).toBeUndefined();
  });
});

describe("screen read models", () => {
  it("suggests templates usually logged around this time", () => {
    const db = seededDb();
    for (const d of [3, 4, 5]) logTemplate(db, "tpl-gym", { now: bkk(2026, 11, d + 7, 18), clientRequestId: `gym-request-${d}` });
    logTemplate(db, "tpl-maths", { now: bkk(2026, 11, 12, 8), clientRequestId: "maths-request-1" });
    expect(suggestedNow(db, bkk(2026, 11, 13, 18, 10)).map((x) => x.id)).toEqual(["tpl-gym"]);
  });

  it("summarises today and last week", () => {
    const db = seededDb();
    createActivity(db, piano(20, bkk(2026, 11, 15, 17)), NOW);
    createActivity(db, piano(40, bkk(2026, 11, 10, 17)), NOW);
    expect(today(db, NOW)).toMatchObject({ minutes: 20, sessions: 1, done: 1, total: 2 });
    const review = weekInReview(db, bkk(2026, 11, 16, 9));
    expect(review).toMatchObject({ week: "2026-W46", minutes: 60, sessions: 2 });
  });

  it("explains an activity and a quest from the ledger", () => {
    const db = seededDb();
    const { activity } = createActivity(db, piano(130, bkk(2026, 11, 10, 17)), NOW);
    const a = activityDetail(db, activity.id)!;
    expect(a.breakdown.total).toBe(110);
    expect(a.completed).toEqual(expect.arrayContaining(["Weekly piano: 120 minutes"]));
    const q = questDetail(db, "weekly-piano", NOW)!;
    expect(q.contributions.map((c) => c.activityId)).toEqual([activity.id]);
    expect(q.history).toHaveLength(1);
  });
});

describe("dropdown logger options", () => {
  it("offers every template and every active skill, with a sensible default type", () => {
    const db = seededDb();
    const o = quickLogOptions(db);
    expect(o.templates.length).toBeGreaterThan(5);
    expect(o.templates.every((x) => x.skills.length > 0)).toBe(true);
    expect(o.skills.find((s) => s.name === "Mathematics")?.activityTypeId).toBe("study");
    expect(o.skills.find((s) => s.name === "Tennis")?.activityTypeId).toBe("training");
    expect(o.skills.find((s) => s.name === "Piano")?.activityTypeId).toBe("practice");
  });
});
