/**
 * Randomized stress test. Runs a long, seeded mix of every write the app can
 * make and checks, after each batch, that the stored totals match a full
 * rebuild (verify() === []) and that nothing threw an unexpected error.
 *
 *   npm test                       → 3 seeds × 400 steps
 *   FUZZ_STEPS=3000 FUZZ_SEEDS=10 npx vitest run tests/stress   → heavy run
 */
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { createActivity, deleteActivity, restoreActivity, startTimer, stopTimer, cancelTimer, updateActivity } from "@/services/activities";
import { answerCalendar, calendarInbox, importTimetable, storeFeed } from "@/services/calendar";
import { verify } from "@/services/engine";
import { ValidationError } from "@/services/errors";
import { importHealthJson } from "@/services/health-import";
import { characterSummary, questBoard, skillSummaries, traitScores, xpTotals } from "@/services/queries";
import { awardMedal, createAssessment, deleteAssessment, recalculateAll, removeMedalAward, restoreAssessment, updateAssessment } from "@/services/records";
import { addHomework, addTest, completeHomework, recordTestResult, reopenHomework } from "@/services/schoolwork";
import { setSkillArchived } from "@/services/skills";
import { bkk, seededDb } from "../integration/helpers";

const STEPS = Number(process.env.FUZZ_STEPS ?? 400);
const SEEDS = Number(process.env.FUZZ_SEEDS ?? 3);
const CHECK_EVERY = Number(process.env.FUZZ_CHECK ?? 25);

/** Small deterministic RNG (mulberry32) so a failure can be replayed. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
  };
}

const SKILLS = ["piano", "mathematics", "physics", "chemistry", "biology", "economics", "tennis", "swimming", "track", "gym", "volleyball", "robotics", "programming", "resilience", "geography", "english"];
const ACADEMIC = ["mathematics", "physics", "chemistry", "biology", "economics", "english", "geography"];
const TYPES = ["practice", "study", "training", "lesson", "project", "light", "competition", "exam"];
const DIFFS = ["very_easy", "easy", "normal", "hard", "very_hard"] as const;
const DAY = 86_400_000;

function run(seed: number) {
  const r = rng(seed);
  const db = seededDb();
  const start = bkk(2026, 9, 1, 8);
  let now = start;
  const log: string[] = [];
  const expected = (e: unknown) => e instanceof ValidationError;

  importTimetable(
    db,
    {
      weekAnchor: "2026-08-31",
      slots: [
        { title: "Mathematics", kind: "lesson", day: "Mon", week: 1, start: "10:05", end: "11:00", skill: "mathematics" },
        { title: "Biology tutoring", kind: "tutoring", day: "Mon", week: null, start: "20:30", end: "22:00", skill: "biology" },
        { title: "Physics tutoring", kind: "tutoring", day: "Tue", week: null, start: "18:00", end: "19:30", skill: "physics" },
        { title: "Admissions Office", kind: "duty", day: "Sun", week: 2, start: "11:30", end: "13:00", skill: "resilience" },
      ],
      breaks: [{ name: "Half term", from: "2026-10-19", to: "2026-10-23", scope: "school" }],
    },
    start,
  );
  storeFeed(
    db,
    Array.from({ length: 30 }, (_, i) => ({
      uid: `vex-${i}`,
      title: i % 5 === 0 ? "Y11 DOEIA" : "VEX Robotics Competition",
      titleKey: i % 5 === 0 ? "y11 doeia" : "vex robotics competition",
      location: "A205",
      category: null,
      startAt: start + i * 3 * DAY + 7 * 3_600_000,
      endAt: start + i * 3 * DAY + 7 * 3_600_000 + 55 * 60_000,
      allDay: false,
      cancelled: i % 7 === 0,
    })),
    start,
  );

  const activityIds = () => db.select({ id: t.activities.id, del: t.activities.deletedAt }).from(t.activities).all();
  const assessmentIds = () => db.select({ id: t.assessments.id, del: t.assessments.deletedAt }).from(t.assessments).all();

  const ops: [number, string, () => void][] = [
    [30, "create activity", () => {
      const n = r.int(1, 3);
      const skills = [...new Set(Array.from({ length: n }, () => r.pick(SKILLS)))].map((skillId) => ({ skillId, weight: r.int(1, 100) }));
      const durationMin = r.chance(0.05) ? r.int(241, 480) : r.int(1, 180);
      createActivity(
        db,
        {
          name: `Fuzz ${r.int(1, 9999)}`,
          startAt: now - r.int(0, 30) * DAY - r.int(0, 23) * 3_600_000,
          durationMin,
          activityTypeId: r.pick(TYPES),
          difficulty: r.pick(DIFFS),
          skills,
          confirmLong: durationMin > 240,
          clientRequestId: r.chance(0.05) ? "fuzz-repeat-request-id" : `fuzz-${seed}-${r.int(0, 1e9)}`,
        },
        now,
      );
    }],
    [12, "update activity", () => {
      const live = activityIds().filter((a) => a.del === null);
      if (!live.length) return;
      const id = r.pick(live).id;
      const patch: Record<string, unknown> = {};
      if (r.chance(0.5)) patch.durationMin = r.int(1, 200);
      if (r.chance(0.4)) patch.startAt = now - r.int(0, 40) * DAY;
      if (r.chance(0.3)) patch.difficulty = r.pick(DIFFS);
      if (r.chance(0.3)) patch.skills = [{ skillId: r.pick(SKILLS), weight: 100 }];
      if (r.chance(0.2)) patch.activityTypeId = r.pick(TYPES);
      updateActivity(db, id, patch, now);
    }],
    [8, "delete activity", () => {
      const live = activityIds().filter((a) => a.del === null);
      if (live.length) deleteActivity(db, r.pick(live).id, now);
    }],
    [4, "restore activity", () => {
      const dead = activityIds().filter((a) => a.del !== null);
      if (dead.length) restoreActivity(db, r.pick(dead).id);
    }],
    [6, "create assessment", () => {
      const skillId = r.pick(ACADEMIC);
      createAssessment(db, { skillId, measurementTypeId: `${skillId}-exam`, assessedAt: now - r.int(0, 60) * DAY, rawValue: r.int(0, 100), method: r.pick(["timed_test", "examination"] as const) });
    }],
    [3, "update assessment", () => {
      const live = assessmentIds().filter((a) => a.del === null);
      if (live.length) updateAssessment(db, r.pick(live).id, { rawValue: r.int(0, 100), assessedAt: now - r.int(0, 60) * DAY });
    }],
    [3, "delete assessment", () => {
      const live = assessmentIds().filter((a) => a.del === null);
      if (live.length) deleteAssessment(db, r.pick(live).id, now);
    }],
    [2, "restore assessment", () => {
      const dead = assessmentIds().filter((a) => a.del !== null);
      if (dead.length) restoreAssessment(db, r.pick(dead).id);
    }],
    [3, "award medal", () => {
      awardMedal(db, { medalId: r.pick(["abrsm-grade", "vex-award", "ukmt", "perfect-term", "school-team"]), occasionKey: `fuzz-${r.int(0, 40)}`, awardedAt: now - r.int(0, 100) * DAY, tierOverride: r.chance(0.3) ? r.pick(["bronze", "silver", "gold"] as const) : null });
    }],
    [2, "remove medal", () => {
      const all = db.select().from(t.medalAwards).all();
      if (all.length) removeMedalAward(db, r.pick(all).id);
    }],
    [6, "homework", () => {
      const h = addHomework(db, { title: `HW ${r.int(1, 999)}`, skillId: r.pick(ACADEMIC), dueAt: now + r.int(-3, 10) * DAY }, now);
      if (r.chance(0.7)) completeHomework(db, h.id, r.chance(0.6) ? r.pick([15, 30, 45, 60, 90, 120]) : null, now + r.int(-2, 5) * DAY);
    }],
    [3, "reopen homework", () => {
      const done = db.select().from(t.homework).all().filter((h) => h.completedAt);
      if (done.length) reopenHomework(db, r.pick(done).id, r.chance(0.5));
    }],
    [3, "test + result", () => {
      const x = addTest(db, { skillId: r.pick(ACADEMIC), startAt: now - r.int(0, 20) * DAY, durationMin: r.pick([55, 115]) }, now);
      if (r.chance(0.7)) {
        const outOf = r.int(1, 80);
        recordTestResult(db, x.id, r.int(0, outOf), outOf);
      }
    }],
    [5, "calendar answer", () => {
      const inbox = calendarInbox(db, now);
      if (!inbox.length) return;
      const o = r.pick(inbox);
      answerCalendar(db, { key: o.key, answer: r.pick(["went", "went", "missed", "never"] as const), skillId: o.needsSkill ? r.pick(SKILLS) : undefined, remember: r.chance(0.5) }, now);
    }],
    [3, "health import", () => {
      const ws = Array.from({ length: r.int(1, 4) }, () => {
        const s = now - r.int(0, 20) * DAY - r.int(0, 12) * 3_600_000;
        const mins = r.int(2, 150);
        const iso = (ms: number) => new Date(ms).toISOString();
        return { name: r.pick(["Tennis", "Pool Swim", "Running", "Hiking", "Volleyball", "Traditional Strength Training"]), start: iso(s), end: iso(s + mins * 60_000), duration: mins * 60, heartRate: { avg: { qty: r.int(90, 185) } } };
      });
      importHealthJson(db, JSON.stringify({ data: { workouts: ws } }), null, now);
    }],
    [2, "timer", () => {
      cancelTimer(db);
      startTimer(db, r.pick(["tpl-piano", "tpl-gym", "tpl-maths"]), now - r.int(1, 120) * 60_000);
      if (r.chance(0.8)) stopTimer(db, { now, confirmLong: true });
    }],
    [1, "archive skill", () => {
      setSkillArchived(db, r.pick(["volleyball", "economics", "geography"]), r.chance(0.5));
    }],
    [1, "recalculate all", () => {
      recalculateAll(db);
    }],
  ];
  const total = ops.reduce((s, o) => s + o[0], 0);

  for (let step = 1; step <= STEPS; step++) {
    now += r.int(10, 360) * 60_000; // time moves 10 min to 6 h per step
    let x = r.next() * total;
    const op = ops.find((o) => (x -= o[0]) < 0)!;
    try {
      op[2]();
      log.push(`${step}: ${op[1]}`);
    } catch (e) {
      if (!expected(e)) throw new Error(`seed ${seed}, step ${step} (${op[1]}): ${(e as Error).stack}\nlast steps: ${log.slice(-8).join(", ")}`);
      log.push(`${step}: ${op[1]} (rejected: ${(e as Error).message})`);
    }
    if (step % CHECK_EVERY === 0 || step === STEPS) {
      const diff = verify(db);
      if (diff.length) throw new Error(`seed ${seed}, step ${step}: stored data differs from a rebuild:\n${diff.slice(0, 10).join("\n")}\nlast steps: ${log.slice(-8).join(", ")}`);
      // Read paths must not throw either.
      characterSummary(db, now);
      skillSummaries(db, now);
      questBoard(db, now);
      traitScores(db, now);
      const totals = xpTotals(db);
      for (const [k, v] of totals.bySkill) if (!Number.isFinite(v)) throw new Error(`skill ${k} XP is ${v}`);
    }
  }
  // No live activity points at a skill that doesn't exist.
  const orphans = db
    .select()
    .from(t.activitySkills)
    .leftJoin(t.skills, eq(t.activitySkills.skillId, t.skills.id))
    .leftJoin(t.activities, and(eq(t.activitySkills.activityId, t.activities.id), isNull(t.activities.deletedAt)))
    .all()
    .filter((row) => row.activities && !row.skills);
  expect(orphans).toEqual([]);
  return log;
}

describe("randomized stress", () => {
  for (let s = 1; s <= SEEDS; s++) {
    it(`seed ${s}: ${STEPS} random operations keep the books balanced`, () => {
      const log = run(s * 7919);
      expect(log.length).toBe(STEPS);
    }, 600_000);
  }
});
