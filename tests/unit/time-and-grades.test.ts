import { describe, expect, it } from "vitest";
import { DEFAULT_GRADE_BANDS as BANDS } from "@/domain/defaults";
import { gradeFor, gradeProgress, normalize, proficiency, type MeasurementTypeDef } from "@/domain/proficiency";
import { addDays, dayKey, isoWeekOfDay, localToUtc, mondayOfWeek, periodKey, periodRange, weekKey } from "@/domain/time";

const S = { timezone: "Asia/Bangkok", dayBoundaryMinutes: 240 };
const bkk = (y: number, m: number, d: number, h = 0, min = 0) => localToUtc("Asia/Bangkok", y, m, d, h, min);

describe("day boundary at 04:00 Bangkok", () => {
  it("puts 03:59 on the previous day and 04:00 on the new day", () => {
    expect(dayKey(bkk(2026, 11, 15, 3, 59), S)).toBe("2026-11-14");
    expect(dayKey(bkk(2026, 11, 15, 4, 0), S)).toBe("2026-11-15");
    expect(dayKey(bkk(2026, 11, 15, 0, 30), S)).toBe("2026-11-14");
    expect(dayKey(bkk(2026, 11, 15, 23, 59), S)).toBe("2026-11-15");
  });

  it("converts local time to UTC with the +7 offset", () => {
    expect(new Date(bkk(2026, 11, 15, 7, 0)).toISOString()).toBe("2026-11-15T00:00:00.000Z");
  });

  it("gives day ranges that start and end at 04:00", () => {
    const r = periodRange("daily", "2026-11-15", S);
    expect(r.start).toBe(bkk(2026, 11, 15, 4));
    expect(r.end).toBe(bkk(2026, 11, 16, 4));
  });
});

describe("weeks", () => {
  it("changes week from Sunday to Monday", () => {
    expect(weekKey(bkk(2026, 11, 15, 20), S)).toBe("2026-W46"); // Sunday
    expect(weekKey(bkk(2026, 11, 16, 3), S)).toBe("2026-W46"); // Monday 03:00 still Sunday
    expect(weekKey(bkk(2026, 11, 16, 5), S)).toBe("2026-W47"); // Monday after 04:00
  });

  it("handles the ISO year edge (2026 has a week 53)", () => {
    expect(isoWeekOfDay("2026-12-31")).toBe("2026-W53");
    expect(isoWeekOfDay("2027-01-03")).toBe("2026-W53");
    expect(isoWeekOfDay("2027-01-04")).toBe("2027-W01");
    expect(isoWeekOfDay("2026-01-01")).toBe("2026-W01");
    expect(mondayOfWeek("2026-W53")).toBe("2026-12-28");
    expect(mondayOfWeek("2026-W46")).toBe("2026-11-09");
  });

  it("gives week ranges from Monday 04:00 to the next Monday 04:00", () => {
    const r = periodRange("weekly", "2026-W46", S);
    expect(r.start).toBe(bkk(2026, 11, 9, 4));
    expect(r.end).toBe(bkk(2026, 11, 16, 4));
  });

  it("uses one key for long-term quests", () => {
    expect(periodKey("long_term", bkk(2026, 1, 1), S)).toBe("once");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("proficiency", () => {
  const swim: MeasurementTypeDef = {
    id: "swim50",
    valueKind: "time",
    direction: "lower",
    anchorLow: 60,
    anchorHigh: 25,
    gradeScale: null,
    weight: 1,
  };
  const pct: MeasurementTypeDef = { id: "pct", valueKind: "percent", direction: "higher", anchorLow: 0, anchorHigh: 100, gradeScale: null, weight: 0 };
  const gcse: MeasurementTypeDef = {
    id: "gcse",
    valueKind: "grade",
    direction: "higher",
    anchorLow: null,
    anchorHigh: null,
    gradeScale: [
      { label: "9", score: 95 },
      { label: "8", score: 88 },
      { label: "7", score: 80 },
    ],
    weight: 1,
  };
  const fact = (id: string, mt: string, at: number, rawValue: number | null, rawLabel: string | null = null, notRepresentative = false) => ({
    id,
    measurementTypeId: mt,
    assessedAt: at,
    rawValue,
    rawLabel,
    notRepresentative,
    createdAt: at,
  });

  it("normalizes lower-is-better results (32.4 s scores 79)", () => {
    expect(Math.round(normalize(swim, 32.4, null)!)).toBe(79);
  });

  it("clamps to 0-100", () => {
    expect(normalize(swim, 80, null)).toBe(0);
    expect(normalize(swim, 20, null)).toBe(100);
    expect(normalize(pct, 120, null)).toBe(100);
  });

  it("scores grade scales by label", () => {
    expect(normalize(gcse, null, "8")).toBe(88);
    expect(normalize(gcse, null, "U")).toBeNull();
  });

  it("uses the latest result of the primary measurement", () => {
    const r = proficiency("primary", "gcse", [gcse, pct], [fact("a", "gcse", 1, null, "7"), fact("b", "gcse", 2, null, "9"), fact("c", "pct", 3, 40)]);
    expect(r.score).toBe(95);
    expect(r.basis).toEqual(["b"]);
  });

  it("ignores results marked not representative", () => {
    const r = proficiency("primary", "pct", [pct], [fact("a", "pct", 1, 90), fact("b", "pct", 2, 59.5, null, true)]);
    expect(r.score).toBe(90);
  });

  it("averages only weighted types in the weighted model", () => {
    const lit = { ...gcse, id: "lit" };
    const r = proficiency("weighted", null, [gcse, lit, pct], [fact("a", "gcse", 1, null, "9"), fact("b", "lit", 1, null, "7"), fact("c", "pct", 1, 10)]);
    expect(r.exact).toBeCloseTo(87.5);
  });

  it("returns null when not assessed", () => {
    expect(proficiency("primary", "gcse", [gcse], []).score).toBeNull();
  });
});

describe("grades", () => {
  it("is exact at, just below and just above each band", () => {
    expect(gradeFor(90, BANDS)).toBe("S");
    expect(gradeFor(89, BANDS)).toBe("A");
    expect(gradeFor(80, BANDS)).toBe("A");
    expect(gradeFor(79, BANDS)).toBe("B");
    expect(gradeFor(65, BANDS)).toBe("B");
    expect(gradeFor(64, BANDS)).toBe("C");
    expect(gradeFor(50, BANDS)).toBe("C");
    expect(gradeFor(49, BANDS)).toBe("D");
    expect(gradeFor(35, BANDS)).toBe("D");
    expect(gradeFor(34, BANDS)).toBe("E");
    expect(gradeFor(20, BANDS)).toBe("E");
    expect(gradeFor(19, BANDS)).toBe("F");
    expect(gradeFor(0, BANDS)).toBe("F");
    expect(gradeFor(null, BANDS)).toBeNull();
  });

  it("shows progress toward the next grade", () => {
    expect(gradeProgress(63, BANDS)).toEqual({ next: "B", progress: 13 / 15 });
    expect(gradeProgress(95, BANDS).next).toBeNull();
  });
});
