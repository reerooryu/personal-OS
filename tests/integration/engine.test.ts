import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { DEFAULT_FORMULA } from "@/domain/defaults";
import { createActivity, deleteActivity, findLikelyDuplicate, logTemplate, previewQuickEntry, restoreActivity, startTimer, stopTimer, updateActivity } from "@/services/activities";
import { reconcileAfterActivity, reconcileAll, verify } from "@/services/engine";
import { ValidationError } from "@/services/errors";
import { questBoard, skillSummaries, unreadNotices } from "@/services/queries";
import { createAssessment, createQuest, deleteAssessment, previewRecalculate, recalculateAll, saveFormula, setMilestone, setQuestStatus, updateAssessment, updateQuestRequirements } from "@/services/records";
import { NOW, bkk, characterXp, piano, seededDb, skillXp } from "./helpers";

const completions = (db: ReturnType<typeof seededDb>, questId: string) =>
  db.select().from(t.questCompletions).where(eq(t.questCompletions.questId, questId)).all();
const rewardRows = (db: ReturnType<typeof seededDb>, questId: string) =>
  db.select().from(t.xpEntries).where(eq(t.xpEntries.sourceType, "quest_completion")).all().filter((e) => e.sourceId.startsWith(`${questId}|`));

describe("activity creation", () => {
  it("awards XP, updates quests and writes a journal entry from one log", () => {
    const db = seededDb();
    const r = createActivity(db, piano(20, bkk(2026, 11, 15, 17)), NOW);
    expect(r.created).toBe(true);
    expect(r.xp).toBe(20);
    expect(characterXp(db)).toBe(20 + 10); // + daily piano reward
    expect(skillXp(db, "piano")).toBe(20 + 10);
    expect(completions(db, "daily-piano")).toHaveLength(1);
    const weekly = db
      .select()
      .from(t.questContributions)
      .where(and(eq(t.questContributions.questId, "weekly-piano"), eq(t.questContributions.periodKey, "2026-W46")))
      .all();
    expect(weekly.map((c) => c.amount)).toEqual([20]);
    const journal = db.select().from(t.journalEntries).where(eq(t.journalEntries.activityId, r.activity.id)).get();
    expect(journal?.body).toContain("+20 XP (Piano 20)");
    expect(journal?.body).toContain("Completed Practice piano for 20 minutes");
    expect(verify(db)).toEqual([]);
  });

  it("rejects invalid input with clear messages", () => {
    const db = seededDb();
    expect(() => createActivity(db, piano(0, NOW - 3_600_000), NOW)).toThrow(ValidationError);
    expect(() => createActivity(db, piano(481, NOW - 3_600_000), NOW)).toThrow(/480/);
    expect(() => createActivity(db, piano(300, NOW - 6 * 3_600_000), NOW)).toThrow(/confirmation/);
    expect(() => createActivity(db, piano(20, NOW + 3_600_000), NOW)).toThrow(/future/);
    expect(() => createActivity(db, { ...piano(20, NOW - 3_600_000), skills: [{ skillId: "piano", weight: 60 }] }, NOW)).toThrow(/100%/);
    expect(() => createActivity(db, { ...piano(20, NOW - 3_600_000), skills: [{ skillId: "consistency", weight: 100 }] }, NOW)).toThrow(/habits/);
    expect(createActivity(db, { ...piano(300, NOW - 6 * 3_600_000), confirmLong: true }, NOW).xp).toBe(195);
  });

  it("never creates a duplicate for the same request or import", () => {
    const db = seededDb();
    const input = piano(30, bkk(2026, 11, 14, 17));
    const a = createActivity(db, input, NOW);
    const b = createActivity(db, input, NOW);
    expect(b.created).toBe(false);
    expect(b.activity.id).toBe(a.activity.id);
    const imp = { ...piano(30, bkk(2026, 11, 13, 17)), clientRequestId: null, source: "import" as const, externalId: "strava-1" };
    createActivity(db, imp, NOW);
    expect(createActivity(db, imp, NOW).created).toBe(false);
    expect(db.select().from(t.activities).all()).toHaveLength(2);
    expect(characterXp(db)).toBe(30 + 10 + 30 + 10);
  });

  it("warns about likely duplicates", () => {
    const db = seededDb();
    createActivity(db, piano(30, bkk(2026, 11, 14, 17)), NOW);
    expect(findLikelyDuplicate(db, { name: "piano practice", durationMin: 30, startAt: bkk(2026, 11, 14, 17, 8) })).not.toBeNull();
    expect(findLikelyDuplicate(db, { name: "piano practice", durationMin: 30, startAt: bkk(2026, 11, 14, 17, 30) })).toBeNull();
  });
});

describe("idempotency", () => {
  it("writes nothing when the same activity is reconciled again", () => {
    const db = seededDb();
    const { activity } = createActivity(db, piano(45, bkk(2026, 11, 15, 9)), NOW);
    const before = db.select().from(t.xpEntries).all().length;
    const again = db.transaction((tx) => reconcileAfterActivity(tx, activity.id, [activity.startAt]));
    const all = db.transaction((tx) => reconcileAll(tx));
    expect(again.count).toBe(0);
    expect(all.count).toBe(0);
    expect(db.select().from(t.xpEntries).all().length).toBe(before);
  });
});

describe("editing and deleting", () => {
  it("posts corrections when duration changes, and totals match a fresh calculation", () => {
    const db = seededDb();
    const { activity } = createActivity(db, piano(30, bkk(2026, 11, 10, 17)), NOW);
    updateActivity(db, activity.id, { durationMin: 150 }, NOW); // 120 XP
    // + daily piano 10, weekly piano 50 and Grade 7 practice 50 (150 minutes meets both weeklies)
    expect(skillXp(db, "piano")).toBe(120 + 10 + 50 + 50);
    updateActivity(db, activity.id, { durationMin: 10 }, NOW); // 10 XP, daily quest no longer met
    expect(characterXp(db)).toBe(10);
    const ledger = db.select().from(t.xpEntries).where(eq(t.xpEntries.sourceId, activity.id)).all();
    expect(ledger.filter((e) => e.targetType === "character").map((e) => e.amount)).toEqual([30, 90, -110]);
    expect(ledger.filter((e) => e.reason === "correction").length).toBeGreaterThan(0);
    expect(db.select().from(t.revisions).where(eq(t.revisions.entityId, activity.id)).all()).toHaveLength(2);
    expect(verify(db)).toEqual([]);
  });

  it("moves progress between periods when the date changes", () => {
    const db = seededDb();
    const { activity } = createActivity(db, piano(130, bkk(2026, 11, 8, 17)), NOW); // week 45
    expect(completions(db, "weekly-piano").map((c) => c.periodKey)).toEqual(["2026-W45"]);
    updateActivity(db, activity.id, { startAt: bkk(2026, 11, 10, 17) }, NOW); // week 46
    expect(completions(db, "weekly-piano").map((c) => c.periodKey)).toEqual(["2026-W46"]);
    expect(verify(db)).toEqual([]);
  });

  it("returns totals exactly to their earlier values after delete and undo", () => {
    const db = seededDb();
    createActivity(db, piano(25, bkk(2026, 11, 12, 17)), NOW);
    const before = characterXp(db);
    const { activity } = createActivity(db, piano(60, bkk(2026, 11, 13, 17)), NOW);
    deleteActivity(db, activity.id, NOW);
    expect(characterXp(db)).toBe(before);
    expect(db.select().from(t.journalEntries).where(eq(t.journalEntries.activityId, activity.id)).get()).toBeUndefined();
    restoreActivity(db, activity.id);
    expect(characterXp(db)).toBe(before + 60 + 10);
    expect(verify(db)).toEqual([]);
  });

  it("keeps a user-edited journal entry when its activity is deleted", () => {
    const db = seededDb();
    const { activity } = createActivity(db, piano(25, bkk(2026, 11, 12, 17)), NOW);
    db.update(t.journalEntries).set({ body: "Great session!", userEdited: true }).where(eq(t.journalEntries.activityId, activity.id)).run();
    updateActivity(db, activity.id, { durationMin: 30 }, NOW);
    expect(db.select().from(t.journalEntries).where(eq(t.journalEntries.activityId, activity.id)).get()).toMatchObject({ body: "Great session!", activityChangedSinceEdit: true });
    deleteActivity(db, activity.id, NOW);
    expect(db.select().from(t.journalEntries).where(eq(t.journalEntries.activityId, activity.id)).get()).toMatchObject({ body: "Great session!", activityDeleted: true });
  });
});

describe("quests", () => {
  it("rewards a completion exactly once, even when reprocessed", () => {
    const db = seededDb();
    const a = createActivity(db, piano(70, bkk(2026, 11, 10, 17)), NOW);
    createActivity(db, piano(60, bkk(2026, 11, 11, 17)), NOW);
    expect(completions(db, "weekly-piano")).toHaveLength(1);
    db.transaction((tx) => reconcileAll(tx));
    db.transaction((tx) => reconcileAfterActivity(tx, a.activity.id, [a.activity.startAt]));
    const rewards = rewardRows(db, "weekly-piano");
    expect(rewards.reduce((s, e) => s + (e.targetType === "character" ? e.amount : 0), 0)).toBe(50);
    expect(rewards.filter((e) => e.targetType === "character")).toHaveLength(1);
  });

  it("reverses the reward and reopens the quest when the completing activity is deleted", () => {
    const db = seededDb();
    createActivity(db, piano(70, bkk(2026, 11, 10, 17)), NOW);
    const b = createActivity(db, piano(60, bkk(2026, 11, 11, 17)), NOW);
    const withReward = characterXp(db);
    deleteActivity(db, b.activity.id, NOW);
    expect(completions(db, "weekly-piano")).toHaveLength(0);
    expect(characterXp(db)).toBe(withReward - 60 - 10 - 50);
    expect(unreadNotices(db).some((n) => n.message.includes("Weekly piano"))).toBe(true);
    expect(verify(db)).toEqual([]);
  });

  it("rewards recurring quests separately per period", () => {
    const db = seededDb();
    createActivity(db, piano(20, bkk(2026, 11, 13, 17)), NOW);
    createActivity(db, piano(20, bkk(2026, 11, 14, 17)), NOW);
    createActivity(db, piano(20, bkk(2026, 11, 14, 19)), NOW); // same day: no second reward
    expect(completions(db, "daily-piano").map((c) => c.periodKey).sort()).toEqual(["2026-11-13", "2026-11-14"]);
    expect(rewardRows(db, "daily-piano").filter((e) => e.targetType === "character").length).toBe(2);
  });

  it("counts a 00:30 session toward the previous day", () => {
    const db = seededDb();
    createActivity(db, piano(20, bkk(2026, 11, 15, 0, 30)), NOW);
    expect(completions(db, "daily-piano").map((c) => c.periodKey)).toEqual(["2026-11-14"]);
  });

  it("ignores activities from before a stage started, even if backdated later", () => {
    const db = seededDb();
    createQuest(db, {
      id: "two-stage",
      title: "Two stages",
      kind: "long_term",
      rewardXp: 100,
      requirements: [
        { stageOrdinal: 1, type: "sessions", target: 1, filter: { skillIds: ["piano"] } },
        { stageOrdinal: 2, type: "sessions", target: 1, filter: { skillIds: ["piano"] } },
      ],
    });
    createActivity(db, piano(30, bkk(2026, 11, 10, 17)), NOW); // completes stage 1 at 17:30
    const overlap = createActivity(db, piano(30, bkk(2026, 11, 10, 17, 15)), NOW); // starts before stage 1 finished
    expect(completions(db, "two-stage")).toHaveLength(0);
    deleteActivity(db, overlap.activity.id, NOW);
    // A session backdated to Nov 9 becomes the earliest: it completes stage 1, so stage 2 opens
    // at 17:30 on Nov 9 and the Nov 10 session completes it. Stages follow the real timeline.
    createActivity(db, piano(30, bkk(2026, 11, 9, 17)), NOW);
    expect(completions(db, "two-stage")).toHaveLength(1);
    expect(verify(db)).toEqual([]);
  });

  it("keeps a locked quest closed until its prerequisite is done", () => {
    const db = seededDb();
    createQuest(db, { id: "first", title: "First", kind: "long_term", requirements: [{ id: "m", type: "milestone", target: 1 }] });
    createQuest(db, { id: "second", title: "Second", kind: "long_term", prerequisiteIds: ["first"], requirements: [{ type: "sessions", target: 1, filter: { skillIds: ["piano"] } }] });
    createActivity(db, piano(30, bkk(2026, 11, 10, 17)), NOW);
    expect(questBoard(db, NOW).find((q) => q.id === "second")?.state).toBe("locked");
    expect(completions(db, "second")).toHaveLength(0);
    setMilestone(db, "first:v1:m", "once", true, bkk(2026, 11, 11, 9));
    // The Nov 10 session happened before the prerequisite was done, so it doesn't count.
    expect(completions(db, "second")).toHaveLength(0);
    createActivity(db, piano(30, bkk(2026, 11, 12, 17)), NOW);
    expect(completions(db, "second")).toHaveLength(1);
    expect(verify(db)).toEqual([]);
  });

  it("rejects dependency cycles and recurring prerequisites", () => {
    const db = seededDb();
    createQuest(db, { id: "a", title: "A", kind: "long_term", requirements: [{ type: "milestone", target: 1 }] });
    createQuest(db, { id: "b", title: "B", kind: "long_term", prerequisiteIds: ["a"], requirements: [{ type: "milestone", target: 1 }] });
    expect(() => createQuest(db, { id: "c", title: "C", kind: "long_term", prerequisiteIds: ["daily-piano"], requirements: [{ type: "milestone", target: 1 }] })).toThrow(/repeats/);
    expect(() =>
      updateQuestRequirements(db, "a", [{ type: "subquests", target: 1, subQuestIds: ["b"] }]),
    ).toThrow(/depend on itself/);
  });

  it("keeps past periods on the rules they ran under when requirements change", () => {
    const db = seededDb();
    createActivity(db, piano(130, bkk(2026, 11, 3, 17)), NOW); // week 45: done at 120
    updateQuestRequirements(db, "weekly-piano", [{ type: "duration", target: 200, filter: { skillIds: ["piano"] } }], NOW);
    expect(completions(db, "weekly-piano").map((c) => c.periodKey)).toEqual(["2026-W45"]);
    createActivity(db, piano(130, bkk(2026, 11, 10, 17)), NOW); // week 46 now needs 200
    expect(completions(db, "weekly-piano").map((c) => c.periodKey)).toEqual(["2026-W45"]);
    expect(verify(db)).toEqual([]);
  });

  it("stops counting an archived quest from the archive date but keeps its history", () => {
    const db = seededDb();
    createActivity(db, piano(20, bkk(2026, 11, 13, 17)), NOW);
    setQuestStatus(db, "daily-piano", "archived", bkk(2026, 11, 14, 5));
    createActivity(db, piano(20, bkk(2026, 11, 14, 17)), NOW);
    expect(completions(db, "daily-piano").map((c) => c.periodKey)).toEqual(["2026-11-13"]);
    expect(verify(db)).toEqual([]);
  });
});

describe("proficiency and assessments", () => {
  it("changes proficiency only through assessments", () => {
    const db = seededDb();
    const grade = () => skillSummaries(db, NOW).find((s) => s.id === "swimming")!;
    createActivity(db, { ...piano(60, bkk(2026, 11, 14, 8)), name: "Swim", skills: [{ skillId: "swimming", weight: 100 }] }, NOW);
    expect(grade().proficiency).toBeNull();
    const a = createAssessment(db, { skillId: "swimming", measurementTypeId: "swim-50-free", assessedAt: bkk(2026, 11, 14, 9), rawValue: 32.4, method: "timed_test" });
    expect(grade()).toMatchObject({ proficiency: 79, grade: "B" });
    updateAssessment(db, a.id, { rawValue: 30 });
    expect(grade()).toMatchObject({ proficiency: 86, grade: "A" });
    expect(db.select().from(t.revisions).where(eq(t.revisions.entityId, a.id)).all()).toHaveLength(1);
    db.update(t.measurementTypes).set({ anchorLow: 50 }).where(eq(t.measurementTypes.id, "swim-50-free")).run();
    expect(grade().proficiency).toBe(80); // (50 - 30) / (50 - 25)
    deleteAssessment(db, a.id, NOW);
    expect(grade().proficiency).toBeNull();
  });

  it("rejects results that can't be scored", () => {
    const db = seededDb();
    expect(() => createAssessment(db, { skillId: "piano", measurementTypeId: "piano-abrsm", assessedAt: NOW, rawLabel: "Grade 9 Pass", method: "examination" })).toThrow(ValidationError);
    expect(() => createAssessment(db, { skillId: "piano", measurementTypeId: "swim-50-free", assessedAt: NOW, rawValue: 30, method: "examination" })).toThrow(/another skill/);
  });

  it("awards a linked medal once when its quest completes, and removes it if the evidence goes", () => {
    const db = seededDb();
    setMilestone(db, "abrsm-grade-7:v1:register", "once", true, bkk(2026, 12, 1));
    const a = createAssessment(db, { skillId: "piano", measurementTypeId: "piano-abrsm", assessedAt: bkk(2027, 3, 20), rawLabel: "Grade 7 Distinction", method: "examination" });
    expect(completions(db, "abrsm-grade-7")).toHaveLength(1);
    const awards = db.select().from(t.medalAwards).where(eq(t.medalAwards.medalId, "abrsm-piano-grade-7")).all();
    expect(awards).toHaveLength(1);
    expect(characterXp(db)).toBe(500 + 1500); // quest reward + Silver medal
    expect(skillSummaries(db, NOW).find((s) => s.id === "piano")).toMatchObject({ proficiency: 76, grade: "B" });
    db.transaction((tx) => reconcileAll(tx));
    expect(characterXp(db)).toBe(2000);
    deleteAssessment(db, a.id, NOW);
    expect(db.select().from(t.medalAwards).all()).toHaveLength(0);
    expect(characterXp(db)).toBe(0);
    expect(verify(db)).toEqual([]);
  });
});

describe("formula versions", () => {
  it("applies a new formula to new activities only, until recalculated", () => {
    const db = seededDb();
    createActivity(db, piano(40, bkk(2026, 11, 10, 17)), NOW); // 40 + 10
    saveFormula(db, { ...DEFAULT_FORMULA, baseRate: 2 });
    createActivity(db, piano(40, bkk(2026, 11, 11, 17)), NOW); // 80 + 10
    expect(characterXp(db)).toBe(140);
    expect(previewRecalculate(db).characterDelta).toBe(40);
    expect(characterXp(db)).toBe(140); // the preview changed nothing
    recalculateAll(db);
    expect(characterXp(db)).toBe(180);
    expect(verify(db)).toEqual([]);
  });
});

describe("achievements", () => {
  it("unlocks once and is revoked when its condition no longer holds", () => {
    const db = seededDb();
    const unlocked = () => db.select().from(t.achievementUnlocks).all().map((u) => u.achievementId);
    const { activity } = createActivity(db, piano(20, bkk(2026, 11, 14, 17)), NOW);
    expect(unlocked()).toEqual(expect.arrayContaining(["first-activity", "first-quest"]));
    createActivity(db, piano(30, bkk(2026, 11, 14, 19)), NOW);
    expect(unlocked().filter((u) => u === "first-activity")).toHaveLength(1);
    deleteActivity(db, activity.id, NOW);
    expect(unlocked()).toContain("first-activity"); // the second session still counts
    const rest = db.select().from(t.activities).all().find((a) => a.id !== activity.id)!;
    deleteActivity(db, rest.id, NOW);
    expect(unlocked()).not.toContain("first-activity");
    expect(verify(db)).toEqual([]);
  });
});

describe("quick logging", () => {
  it("logs a tile with one call and a timer with two", () => {
    const db = seededDb();
    const tile = logTemplate(db, "tpl-robotics", { now: NOW });
    expect(tile.xp).toBe(90);
    expect(skillXp(db, "robotics")).toBe(63);
    expect(skillXp(db, "programming")).toBe(27);
    startTimer(db, "tpl-piano", NOW - 25 * 60_000);
    expect(() => startTimer(db, "tpl-gym", NOW)).toThrow(/already running/);
    const stopped = stopTimer(db, { now: NOW });
    expect(stopped.activity).toMatchObject({ durationMin: 25, source: "timer" });
    expect(() => stopTimer(db, { now: NOW })).toThrow(/No timer/);
  });

  it("asks for confirmation when a timer ran over four hours", () => {
    const db = seededDb();
    startTimer(db, "tpl-piano", NOW - 300 * 60_000);
    expect(() => stopTimer(db, { now: NOW })).toThrow(/confirmation/);
    expect(stopTimer(db, { now: NOW, confirmLong: true }).activity.durationMin).toBe(300);
  });

  it("turns a typed line into a ready-to-save activity", () => {
    const db = seededDb();
    const p = previewQuickEntry(db, "volleyball 1h30 hard", NOW);
    expect(p.input).toMatchObject({ name: "Volleyball practice", durationMin: 90, difficulty: "hard" });
    expect(p.xp?.total).toBe(113);
    expect(previewQuickEntry(db, "maths 45 past paper", NOW).input).toMatchObject({ name: "Maths revision", durationMin: 45, notes: "past paper" });
    expect(previewQuickEntry(db, "physics", NOW).input?.durationMin).toBe(45);
    expect(previewQuickEntry(db, "geography 30", NOW).input).toMatchObject({ name: "Geography", skills: [{ skillId: "geography", weight: 100 }] });
    expect(previewQuickEntry(db, "zzz 30", NOW).problem).toMatch(/No matching/);
  });
});
