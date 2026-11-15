import { describe, expect, it } from "vitest";
import { DEFAULT_FORMULA as P } from "@/domain/defaults";
import {
  computeXp,
  effectiveMinutes,
  equalWeights,
  levelFromXp,
  roundHalfUp,
  splitByWeights,
  xpForNextLevel,
  xpToReach,
} from "@/domain/xp";

const xp = (durationMin: number, difficulty = "normal", activityTypeId = "practice") =>
  computeXp({ durationMin, difficulty, activityTypeId }, P).total;

describe("XP formula", () => {
  it("matches the spec's worked examples", () => {
    expect(xp(20)).toBe(20); // piano practice
    expect(xp(60, "hard", "project")).toBe(75); // robot build
    expect(xp(150, "normal", "study")).toBe(120); // 90 + 0.5 * 60
    expect(xp(90, "hard", "competition")).toBe(141); // 140.625 rounds up
  });

  it("tapers exactly at the threshold", () => {
    expect(effectiveMinutes(90, P)).toBe(90);
    expect(effectiveMinutes(91, P)).toBe(90.5);
    expect(xp(90)).toBe(90);
    expect(xp(91)).toBe(91); // 90.5 rounds half up
    expect(xp(92)).toBe(91);
  });

  it("handles the duration limits", () => {
    expect(xp(1)).toBe(1);
    expect(xp(480)).toBe(285); // 90 + 0.5 * 390
  });

  it("applies every difficulty and type multiplier", () => {
    expect(xp(40, "very_easy")).toBe(20);
    expect(xp(40, "easy")).toBe(30);
    expect(xp(40, "normal")).toBe(40);
    expect(xp(40, "hard")).toBe(50);
    expect(xp(40, "very_hard")).toBe(60);
    expect(xp(40, "normal", "exam")).toBe(50);
    expect(xp(40, "normal", "light")).toBe(20);
    expect(xp(40, "normal", "unknown-type")).toBe(40);
  });

  it("rounds half up without floating-point surprises", () => {
    expect(roundHalfUp(37.5)).toBe(38);
    expect(roundHalfUp(37.4999)).toBe(37);
    expect(roundHalfUp(0.1 + 0.2 + 2.2)).toBe(3); // 2.5000000000000004
  });

  it("explains its calculation", () => {
    const b = computeXp({ durationMin: 150, difficulty: "hard", activityTypeId: "study" }, P);
    expect(b).toMatchObject({ effectiveMinutes: 120, difficultyMultiplier: 1.25, typeMultiplier: 1, total: 150 });
  });
});

describe("splitting XP across skills", () => {
  it("uses largest remainder so shares sum to the total", () => {
    const s = splitByWeights(75, [
      { skillId: "robotics", weight: 50 },
      { skillId: "programming", weight: 50 },
    ]);
    expect(s.get("robotics")).toBe(38);
    expect(s.get("programming")).toBe(37);
  });

  it("always sums exactly, for many awkward cases", () => {
    for (let total = 0; total < 200; total += 7) {
      for (const weights of [[33, 33, 34], [10, 90], [1, 1, 98], [25, 25, 25, 25], [100]]) {
        const s = splitByWeights(
          total,
          weights.map((w, i) => ({ skillId: `s${i}`, weight: w })),
        );
        expect([...s.values()].reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it("makes equal weights that sum to 100", () => {
    const w = equalWeights(Array.from({ length: 11 }, (_, i) => `k${i}`));
    expect(w.reduce((a, b) => a + b.weight, 0)).toBe(100);
    expect(new Set(w.map((x) => x.weight))).toEqual(new Set([9, 10]));
  });

  it("rejects zero weights", () => {
    expect(() => splitByWeights(10, [{ skillId: "a", weight: 0 }])).toThrow();
  });
});

describe("levels", () => {
  const C = P.characterCurve;
  const S = P.skillCurve;

  it("needs 100 x L^1.5 for the next character level", () => {
    expect(xpForNextLevel(1, C)).toBe(100);
    expect(xpForNextLevel(2, C)).toBe(283);
    expect(xpForNextLevel(10, C)).toBe(3162);
  });

  it("starts at level 1 with 0 XP", () => {
    expect(levelFromXp(0, C)).toMatchObject({ level: 1, intoLevel: 0, toNext: 100 });
  });

  it("is exact at, just below and just above each threshold", () => {
    for (let level = 2; level <= 30; level++) {
      const at = xpToReach(level, C);
      expect(levelFromXp(at, C).level).toBe(level);
      expect(levelFromXp(at - 1, C).level).toBe(level - 1);
      expect(levelFromXp(at + 1, C).level).toBe(level);
    }
  });

  it("places Ryu's starting record correctly", () => {
    expect(levelFromXp(19000, C)).toMatchObject({ level: 12, intoLevel: 1084, levelSize: 4157 });
    expect(levelFromXp(10750, S).level).toBe(12);
    expect(levelFromXp(2500, S).level).toBe(7);
  });

  it("treats negative totals as zero", () => {
    expect(levelFromXp(-50, C).level).toBe(1);
  });
});
