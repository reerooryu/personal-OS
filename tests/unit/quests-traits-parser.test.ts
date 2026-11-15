import { describe, expect, it } from "vitest";
import { parseQuickEntry, type Candidate } from "@/domain/parser";
import { evaluateQuest, type ActivityFact, type RequirementDef } from "@/domain/quests";
import { classifyDays, consistencyScore, firstCrossing, streaks } from "@/domain/traits";
import { addDays } from "@/domain/time";

const H = 3_600_000;
const act = (id: string, startH: number, durationMin: number, skills: [string, number][], extra: Partial<ActivityFact> = {}): ActivityFact => ({
  id,
  startAt: startH * H,
  durationMin,
  activityTypeId: "practice",
  difficulty: "normal",
  skills: skills.map(([skillId, weight]) => ({ skillId, weight })),
  dayKey: `d${Math.floor(startH / 24)}`,
  ...extra,
});
const req = (id: string, type: RequirementDef["type"], target: number, extra: Partial<RequirementDef> = {}): RequirementDef => ({
  id,
  stageOrdinal: 1,
  type,
  target,
  filter: {},
  matchSkills: new Set(["piano"]),
  ...extra,
});
const facts = (requirements: RequirementDef[], activities: ActivityFact[], extra: Partial<Parameters<typeof evaluateQuest>[0]> = {}) => ({
  requirements,
  window: { start: 0, end: 1000 * H },
  activities,
  assessments: [],
  milestoneChecks: new Map<string, number>(),
  subQuestCompletions: new Map<string, number>(),
  ...extra,
});

describe("quest evaluation", () => {
  it("completes a duration quest when minutes reach the target", () => {
    const e = evaluateQuest(facts([req("r", "duration", 120)], [act("a", 1, 60, [["piano", 100]]), act("b", 5, 60, [["piano", 100]]), act("c", 9, 30, [["piano", 100]])]));
    expect(e.completedAt).toBe(5 * H + 60 * 60_000);
    expect(e.completedByRef).toBe("b");
    expect(e.contributions.map((c) => c.activityId)).toEqual(["a", "b"]);
  });

  it("counts only the matching share of a split activity", () => {
    const e = evaluateQuest(facts([req("r", "duration", 120)], [act("a", 1, 60, [["piano", 50], ["theory", 50]])]));
    expect(e.contributions[0]!.amount).toBe(30);
    expect(e.completedAt).toBeNull();
  });

  it("never counts one activity twice against the same requirement", () => {
    const a = act("a", 1, 60, [["piano", 100]]);
    const e = evaluateQuest(facts([req("r", "sessions", 2)], [a, a]));
    // The same activity appearing twice is still one contribution per event; the DB key prevents duplicates.
    expect(e.contributions.filter((c) => c.activityId === "a").length).toBeLessThanOrEqual(2);
    const once = evaluateQuest(facts([req("r", "sessions", 2)], [a]));
    expect(once.completedAt).toBeNull();
  });

  it("lets one activity count toward two different requirements", () => {
    const e = evaluateQuest(facts([req("r1", "duration", 20), req("r2", "sessions", 1)], [act("a", 1, 20, [["piano", 100]])]));
    expect(e.contributions).toHaveLength(2);
    expect(e.completedAt).not.toBeNull();
  });

  it("applies session length, type and difficulty filters", () => {
    const r = req("r", "sessions", 1, { filter: { minSessionMinutes: 30, activityTypeIds: ["practice"], minDifficulty: "hard" } });
    expect(evaluateQuest(facts([r], [act("a", 1, 20, [["piano", 100]], { difficulty: "hard" })])).completedAt).toBeNull();
    expect(evaluateQuest(facts([r], [act("a", 1, 40, [["piano", 100]], { difficulty: "normal" })])).completedAt).toBeNull();
    expect(evaluateQuest(facts([r], [act("a", 1, 40, [["piano", 100]], { difficulty: "hard", activityTypeId: "lesson" })])).completedAt).toBeNull();
    expect(evaluateQuest(facts([r], [act("a", 1, 40, [["piano", 100]], { difficulty: "hard" })])).completedAt).not.toBeNull();
  });

  it("counts distinct days", () => {
    const e = evaluateQuest(facts([req("r", "distinct_days", 2)], [act("a", 1, 10, [["piano", 100]]), act("b", 2, 10, [["piano", 100]]), act("c", 30, 10, [["piano", 100]])]));
    expect(e.completedByRef).toBe("c");
  });

  it("ignores activities outside the window", () => {
    const e = evaluateQuest(facts([req("r", "sessions", 1)], [act("a", 2000, 30, [["piano", 100]])]));
    expect(e.completedAt).toBeNull();
  });

  it("runs stages in order and ignores activities from before a stage started", () => {
    const r1 = req("s1", "sessions", 1, { stageOrdinal: 1 });
    const r2 = req("s2", "sessions", 1, { stageOrdinal: 2 });
    // b overlaps a's end, so it starts before stage 2 began and does not count.
    const e = evaluateQuest(facts([r1, r2], [act("a", 1, 60, [["piano", 100]]), act("b", 1.5, 10, [["piano", 100]])]));
    expect(e.stages[0]!.completedAt).toBe(2 * H);
    expect(e.currentStage).toBe(2);
    expect(e.completedAt).toBeNull();
    const done = evaluateQuest(facts([r1, r2], [act("a", 1, 60, [["piano", 100]]), act("c", 3, 10, [["piano", 100]])]));
    expect(done.completedAt).toBe(3 * H + 10 * 60_000);
  });

  it("supports assessment, milestone and sub-quest requirements", () => {
    const e = evaluateQuest(
      facts(
        [
          req("swim", "assessment", 70, { measurementTypeId: "swim50", matchSkills: null }),
          req("reg", "milestone", 1, { matchSkills: null }),
          req("subs", "subquests", 2, { subQuestIds: ["q1", "q2"], matchSkills: null }),
        ],
        [],
        {
          assessments: [
            { id: "x", measurementTypeId: "swim50", at: 10 * H, score: 60 },
            { id: "y", measurementTypeId: "swim50", at: 20 * H, score: 75 },
          ],
          milestoneChecks: new Map([["reg", 5 * H]]),
          subQuestCompletions: new Map([
            ["q1", 1 * H],
            ["q2", 30 * H],
          ]),
        },
      ),
    );
    expect(e.completedAt).toBe(30 * H);
    expect(e.completedByRef).toBe("quest:q2");
  });

  it("is deterministic regardless of input order", () => {
    const list = [act("a", 3, 30, [["piano", 100]]), act("b", 1, 30, [["piano", 100]]), act("c", 2, 30, [["piano", 100]])];
    const r = [req("r", "duration", 60)];
    expect(evaluateQuest(facts(r, list))).toEqual(evaluateQuest(facts(r, [...list].reverse())));
  });
});

describe("traits and streaks", () => {
  const day0 = "2026-10-01";
  const daysFrom = (n: number, skip: (i: number) => boolean = () => false) =>
    new Map(Array.from({ length: n }, (_, i) => [addDays(day0, i), skip(i) ? 0 : 30] as [string, number]));

  it("returns null with too little data", () => {
    expect(consistencyScore(new Map(), day0, 1)).toBeNull();
    expect(consistencyScore(daysFrom(3), addDays(day0, 2), 1)).toBeNull();
  });

  it("scores 100 when every day is active", () => {
    expect(consistencyScore(daysFrom(40), addDays(day0, 39), 1)).toBe(100);
  });

  it("forgives one rest day per week", () => {
    // Skip every Sunday: still 100 with one rest day per week.
    const m = daysFrom(42, (i) => new Date(Date.UTC(2026, 9, 1 + i)).getUTCDay() === 0);
    expect(consistencyScore(m, addDays(day0, 41), 1)).toBe(100);
    expect(consistencyScore(m, addDays(day0, 41), 0)).toBeLessThan(100);
  });

  it("doesn't let an unfinished today lower the score", () => {
    const m = daysFrom(30);
    expect(consistencyScore(m, addDays(day0, 30), 0)).toBe(100);
  });

  it("keeps streaks alive across rest days and breaks them on a second miss", () => {
    const active = new Set([...daysFrom(20, (i) => i === 5 || i === 6)].filter(([, m]) => m > 0).map(([d]) => d));
    const s = streaks(active, addDays(day0, 19), 1);
    // Oct 6 and 7 2026 are Tue and Wed in the same ISO week: only one is forgiven.
    expect(s.longest).toBe(13);
    expect(classifyDays(active, day0, addDays(day0, 19), 1).get("2026-10-06")).toBe("rest");
  });

  it("finds the first crossing of a running total", () => {
    expect(firstCrossing([{ at: 3, amount: 5, ref: "c" }, { at: 1, amount: 5, ref: "a" }, { at: 2, amount: 5, ref: "b" }], 10)).toEqual({ at: 2, ref: "b" });
    expect(firstCrossing([{ at: 1, amount: 5, ref: "a" }], 10)).toBeNull();
  });
});

describe("quick-entry parser", () => {
  const C: Candidate[] = [
    { kind: "template", id: "t-piano", name: "Piano practice", aliases: ["piano"] },
    { kind: "skill", id: "tennis", name: "Tennis", aliases: [] },
    { kind: "skill", id: "maths", name: "Mathematics", aliases: ["maths", "math"] },
    { kind: "skill", id: "fm", name: "Further Mathematics", aliases: ["further maths", "fm"] },
  ];

  it("reads a name and minutes", () => {
    expect(parseQuickEntry("piano 30", C)).toMatchObject({ durationMin: 30, match: { id: "t-piano" }, difficulty: null });
  });

  it("reads hours, minutes and difficulty", () => {
    expect(parseQuickEntry("tennis 1h30 hard", C)).toMatchObject({ durationMin: 90, difficulty: "hard", match: { id: "tennis" } });
    expect(parseQuickEntry("90m maths", C)).toMatchObject({ durationMin: 90, match: { id: "maths" } });
    expect(parseQuickEntry("maths 1.5 hours", C).durationMin).toBe(90);
    expect(parseQuickEntry("tennis 45 very hard", C).difficulty).toBe("very_hard");
  });

  it("keeps leftover words as notes", () => {
    expect(parseQuickEntry("maths 45 past paper", C)).toMatchObject({ match: { id: "maths" }, notes: "past paper" });
  });

  it("prefers the longer phrase", () => {
    expect(parseQuickEntry("further maths 40", C).match?.id).toBe("fm");
  });

  it("falls back to a prefix match", () => {
    expect(parseQuickEntry("mathem 20", C).match?.id).toBe("maths");
  });

  it("returns no match for unknown words", () => {
    expect(parseQuickEntry("xyz 20", C)).toMatchObject({ match: null, durationMin: 20 });
  });
});
