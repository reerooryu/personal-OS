import { describe, expect, it } from "vitest";
import { planRevision, trendOf } from "@/domain/revision";

const base = { subject: "Mathematics", kind: "test" as const, daysAvailable: 10 };

describe("revision plan sizing", () => {
  it("scales with the current grade", () => {
    const by = (grade: string | null) => planRevision({ ...base, grade, score: null, recentTests: [] });
    expect(by("S")).toMatchObject({ minutes: 60, days: 2 });
    expect(by("A")).toMatchObject({ minutes: 90, days: 2 });
    expect(by("B")).toMatchObject({ minutes: 120, days: 3 });
    expect(by("C")).toMatchObject({ minutes: 150, days: 3 });
    expect(by("E")).toMatchObject({ minutes: 180, days: 4 });
    expect(by(null)).toMatchObject({ minutes: 120, days: 3 });
  });

  it("does more when results are slipping, and says why", () => {
    const steady = planRevision({ ...base, grade: "S", score: 95, recentTests: [100, 95, 97] });
    expect(steady).toMatchObject({ trend: "steady", minutes: 60, days: 2 });
    expect(steady.reason).toBe("Mathematics is at S and recent tests are steady, so a light plan for this test: 60 minutes over 2 days.");
    const slip = planRevision({ ...base, grade: "S", score: 95, recentTests: [98, 96, 82] });
    expect(slip).toMatchObject({ trend: "slipping", minutes: 90, days: 3 });
    expect(slip.reason).toContain("slipping (97% → 82%)");
    // Far below the grade's level counts as slipping even with no earlier tests to compare.
    expect(planRevision({ ...base, grade: "A", score: 85, recentTests: [62] })).toMatchObject({ trend: "slipping", minutes: 135, days: 3 });
    // Improving never shrinks the plan below the grade's base.
    expect(planRevision({ ...base, grade: "B", score: 70, recentTests: [55, 60, 75] })).toMatchObject({ trend: "improving", minutes: 120 });
  });

  it("scales with the kind of test", () => {
    const k = (kind: "quiz" | "test" | "mock" | "exam") => planRevision({ ...base, kind, grade: "B", score: 70, recentTests: [] });
    expect(k("quiz")).toMatchObject({ minutes: 60, days: 2 });
    expect(k("mock")).toMatchObject({ minutes: 180, days: 4 });
    expect(k("exam")).toMatchObject({ minutes: 240, days: 4 });
  });

  it("squeezes into the days left, at most 90 minutes a day", () => {
    const p = planRevision({ ...base, daysAvailable: 1, grade: "C", score: 55, recentTests: [70, 50] });
    expect(p).toMatchObject({ trend: "slipping", minutes: 90, days: 1 });
    expect(p.reason).toContain("There is 1 day left, so it's squeezed.");
  });

  it("reads the trend from up to three recent tests", () => {
    expect(trendOf([], null).trend).toBe("unknown");
    expect(trendOf([80], null).trend).toBe("unknown");
    expect(trendOf([80, 81], null).trend).toBe("steady");
    expect(trendOf([90, 70, 74], null).trend).toBe("steady"); // compared with the mean of the two before: 80
    expect(trendOf([90, 70, 72], null).trend).toBe("slipping"); // a drop of exactly 8 counts
  });
});
