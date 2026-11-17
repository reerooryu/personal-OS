/**
 * Homework and tests.
 *
 * Homework is a checklist with due times. Ticking it off can log the time it
 * took as a study session, and finishing on time feeds Time Management.
 * Tests sit on the calendar with a countdown; afterwards the score becomes an
 * assessment (the subject's "test percentage"), so it shows in Statistics.
 */
import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { gradeFor, normalize, proficiency } from "@/domain/proficiency";
import { planRevision, type RevisionPlan } from "@/domain/revision";
import { addDays, daysBetween } from "@/domain/time";
import { createActivity, deleteActivity } from "./activities";
import { occurrences, todayKey } from "./calendar";
import { getProfile } from "./context";
import { ValidationError, parse } from "./errors";
import { createAssessment, createQuest, deleteQuest } from "./records";

const DAY = 86_400_000;

const homeworkInput = z.object({
  title: z.string().trim().min(1, "Give it a title").max(120),
  skillId: z.string().min(1, "Pick a subject"),
  dueAt: z.number().int(),
  description: z.string().trim().max(2000).nullish(),
});
export type HomeworkInput = z.input<typeof homeworkInput>;

const testInput = z.object({
  title: z.string().trim().max(120).nullish(),
  kind: z.enum(["quiz", "test", "mock", "exam"]).default("test"),
  skillId: z.string().min(1, "Pick a subject"),
  startAt: z.number().int(),
  durationMin: z.number().int().min(5).max(300).default(55),
  notes: z.string().trim().max(2000).nullish(),
});
export type TestInput = z.input<typeof testInput>;

export const TEST_KINDS = { quiz: "Quiz", test: "Test", mock: "Mock exam", exam: "Exam" } as const;

function skill(db: DB, id: string) {
  const s = db.select().from(t.skills).where(eq(t.skills.id, id)).get();
  if (!s || s.kind === "trait") throw ValidationError.one("skillId", "Pick a subject");
  return s;
}

// --------------------------------------------------------------- homework ---

export function addHomework(db: DB, input: HomeworkInput, now = Date.now()) {
  const h = parse(homeworkInput, input);
  skill(db, h.skillId);
  const row = { id: randomUUID(), title: h.title, skillId: h.skillId, dueAt: h.dueAt, description: h.description || null, createdAt: now };
  db.insert(t.homework).values(row).run();
  return row;
}

export function updateHomework(db: DB, id: string, input: HomeworkInput) {
  const h = parse(homeworkInput, input);
  skill(db, h.skillId);
  db.update(t.homework).set({ title: h.title, skillId: h.skillId, dueAt: h.dueAt, description: h.description || null }).where(eq(t.homework.id, id)).run();
}

export function deleteHomework(db: DB, id: string) {
  db.delete(t.homework).where(eq(t.homework.id, id)).run();
}

/**
 * Ticks homework off. With `minutes`, the time is logged as a study session in
 * the subject (ending now), which earns XP like any other study.
 */
export function completeHomework(db: DB, id: string, minutes: number | null, now = Date.now()) {
  const h = db.select().from(t.homework).where(eq(t.homework.id, id)).get();
  if (!h) throw ValidationError.one("id", "That homework is gone");
  if (h.completedAt) return { activityId: h.activityId, xp: 0 };
  let activityId: string | null = null;
  let xp = 0;
  if (minutes) {
    const r = createActivity(
      db,
      {
        name: h.title,
        notes: h.description ? `Homework: ${h.description}` : "Homework",
        startAt: now - minutes * 60_000,
        durationMin: minutes,
        activityTypeId: "study",
        difficulty: "normal",
        skills: [{ skillId: h.skillId, weight: 100 }],
        source: "task",
        clientRequestId: `hw:${h.id}:${now}`,
      },
      now,
    );
    activityId = r.activity.id;
    xp = r.xp;
  }
  db.update(t.homework).set({ completedAt: now, activityId }).where(eq(t.homework.id, id)).run();
  return { activityId, xp };
}

/** Unticks homework. The logged session stays unless `removeActivity` says otherwise. */
export function reopenHomework(db: DB, id: string, removeActivity: boolean) {
  const h = db.select().from(t.homework).where(eq(t.homework.id, id)).get();
  if (!h) throw ValidationError.one("id", "That homework is gone");
  if (removeActivity && h.activityId) deleteActivity(db, h.activityId);
  db.update(t.homework).set({ completedAt: null, activityId: null }).where(eq(t.homework.id, id)).run();
}

// ------------------------------------------------------------------ tests ---

export function addTest(db: DB, input: TestInput, now = Date.now()) {
  const x = parse(testInput, input);
  const s = skill(db, x.skillId);
  const row = {
    id: randomUUID(),
    title: x.title || `${s.name} ${TEST_KINDS[x.kind].toLowerCase()}`,
    kind: x.kind,
    skillId: x.skillId,
    startAt: x.startAt,
    durationMin: x.durationMin,
    notes: x.notes || null,
    createdAt: now,
  };
  db.insert(t.tests).values(row).run();
  syncRevisionQuest(db, row.id, now);
  return row;
}

export function updateTest(db: DB, id: string, input: TestInput, now = Date.now()) {
  const x = parse(testInput, input);
  const s = skill(db, x.skillId);
  db.update(t.tests)
    .set({ title: x.title || `${s.name} ${TEST_KINDS[x.kind].toLowerCase()}`, kind: x.kind, skillId: x.skillId, startAt: x.startAt, durationMin: x.durationMin, notes: x.notes || null })
    .where(eq(t.tests.id, id))
    .run();
  syncRevisionQuest(db, id, now);
}

export function deleteTest(db: DB, id: string) {
  removeRevisionQuest(db, id);
  db.delete(t.tests).where(eq(t.tests.id, id)).run();
}

/** The subject's percentage measurement ("Mathematics test percentage"), if it has one. */
function percentMeasurement(db: DB, skillId: string) {
  return db
    .select()
    .from(t.measurementTypes)
    .where(and(eq(t.measurementTypes.skillId, skillId), eq(t.measurementTypes.valueKind, "percent")))
    .get();
}

/** Records "38 out of 40" as an assessment at the test's date. */
export function recordTestResult(db: DB, id: string, score: number, outOf: number) {
  const x = db.select().from(t.tests).where(eq(t.tests.id, id)).get();
  if (!x) throw ValidationError.one("id", "That test is gone");
  if (!(outOf > 0) || score < 0 || score > outOf) throw ValidationError.one("score", "The score must be between 0 and the total");
  const mt = percentMeasurement(db, x.skillId);
  if (!mt) throw ValidationError.one("skillId", "This subject has no test percentage to record into");
  const a = createAssessment(db, {
    skillId: x.skillId,
    measurementTypeId: mt.id,
    assessedAt: x.startAt,
    rawValue: Math.round((score / outOf) * 1000) / 10,
    method: x.kind === "exam" || x.kind === "mock" ? "examination" : "timed_test",
    notes: `${x.title}: ${score}/${outOf}`,
  });
  db.update(t.tests).set({ assessmentId: a.id, noResult: false }).where(eq(t.tests.id, id)).run();
  return a;
}

export function setNoResult(db: DB, id: string) {
  db.update(t.tests).set({ noResult: true }).where(eq(t.tests.id, id)).run();
}

// ------------------------------------------------------------------ views ---

/**
 * Due-date choices for a subject: its lessons over the next six weeks, so
 * "due next Maths lesson" is one pick and later lessons are a scroll away.
 */
export function lessonChoices(db: DB, now = Date.now()) {
  const today = todayKey(db, now);
  const out: Record<string, { startAt: number; endAt: number; location: string | null; week: 1 | 2 | null }[]> = {};
  for (const o of occurrences(db, today, addDays(today, 42))) {
    if (o.kind !== "lesson" || !o.skillId || o.startAt < now) continue;
    (out[o.skillId] ??= []).push({ startAt: o.startAt, endAt: o.endAt, location: o.location, week: o.week });
  }
  return out;
}

function decorate<T extends { skillId: string }>(db: DB, rows: T[]) {
  const names = new Map(db.select().from(t.skills).all().map((s) => [s.id, s.name]));
  return rows.map((r) => ({ ...r, skillName: names.get(r.skillId) ?? r.skillId }));
}

/** Homework due in a date range (inclusive, local dates) plus everything overdue. */
export function homeworkBetween(db: DB, fromMs: number, toMs: number) {
  return decorate(
    db,
    db
      .select()
      .from(t.homework)
      .where(and(gte(t.homework.dueAt, fromMs), lt(t.homework.dueAt, toMs)))
      .all()
      .sort((a, b) => a.dueAt - b.dueAt),
  );
}

export function overdueHomework(db: DB, now = Date.now()) {
  return decorate(
    db,
    db
      .select()
      .from(t.homework)
      .where(and(lt(t.homework.dueAt, now), isNull(t.homework.completedAt)))
      .all()
      .sort((a, b) => a.dueAt - b.dueAt),
  );
}

export function testsBetween(db: DB, fromMs: number, toMs: number) {
  return decorate(
    db,
    db
      .select()
      .from(t.tests)
      .where(and(gte(t.tests.startAt, fromMs), lt(t.tests.startAt, toMs)))
      .all()
      .sort((a, b) => a.startAt - b.startAt),
  ).map((x) => ({ ...x, hasResultType: !!percentMeasurement(db, x.skillId) }));
}

/** Tests that have happened and still need a result (last 60 days). */
export function testsAwaitingResult(db: DB, now = Date.now()) {
  return testsBetween(db, now - 60 * DAY, now).filter((x) => !x.assessmentId && !x.noResult && x.hasResultType && x.startAt + x.durationMin * 60_000 <= now);
}

/** For Overview: what's overdue, due in the next three days, and tests in the next week. */
export function dueSoon(db: DB, now = Date.now()) {
  return {
    overdue: overdueHomework(db, now),
    upcoming: homeworkBetween(db, now, now + 3 * DAY).filter((h) => !h.completedAt),
    tests: testsBetween(db, now - 2 * 3_600_000, now + 7 * DAY),
    results: testsAwaitingResult(db, now),
  };
}

/**
 * Time Management: homework due in the last 28 days (or done in them), on
 * time or not. Unfinished overdue homework counts as late.
 */
export function homeworkTimeliness(db: DB, now = Date.now()) {
  const since = now - 28 * DAY;
  return db
    .select()
    .from(t.homework)
    .all()
    .filter((h) => (h.dueAt >= since && h.dueAt <= now) || (h.completedAt !== null && h.completedAt >= since))
    .map((h) => ({ onTime: h.completedAt !== null && h.completedAt <= h.dueAt }));
}

// --------------------------------------------------- private file entries ---

const fileHomework = z.object({ title: z.string(), subject: z.string(), due: z.string(), description: z.string().nullish() });
const fileTest = z.object({ title: z.string().nullish(), subject: z.string(), kind: z.enum(["quiz", "test", "mock", "exam"]).default("test"), date: z.string(), durationMin: z.number().int().default(55), notes: z.string().nullish() });

/**
 * Adds homework and tests listed in the private timetable file, once each.
 * Never edits or deletes: after import they belong to the app.
 */
export function importSchoolworkFromFile(db: DB, raw: { homework?: unknown[]; tests?: unknown[] }, toUtc: (local: string) => number, now = Date.now()) {
  let added = 0;
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  for (const r of raw.homework ?? []) {
    const h = fileHomework.parse(r);
    const id = `file-hw-${slug(h.title)}-${slug(h.due)}`;
    if (db.select().from(t.homework).where(eq(t.homework.id, id)).get()) continue;
    skill(db, h.subject);
    db.insert(t.homework).values({ id, title: h.title, skillId: h.subject, dueAt: toUtc(h.due), description: h.description ?? null, createdAt: now }).run();
    added++;
  }
  for (const r of raw.tests ?? []) {
    const x = fileTest.parse(r);
    const id = `file-test-${slug(x.subject)}-${slug(x.date)}`;
    if (db.select().from(t.tests).where(eq(t.tests.id, id)).get()) continue;
    const s = skill(db, x.subject);
    db.insert(t.tests)
      .values({ id, title: x.title || `${s.name} ${TEST_KINDS[x.kind].toLowerCase()}`, kind: x.kind, skillId: x.subject, startAt: toUtc(x.date), durationMin: x.durationMin, notes: x.notes ?? null, createdAt: now })
      .run();
    syncRevisionQuest(db, id, now);
    added++;
  }
  return added;
}

// -------------------------------------------------------- revision quests ---

/**
 * The subject's current grade and recent test percentages, for sizing a
 * revision plan. Unrepresentative results (the Geography fluke) are left out.
 */
function subjectStanding(db: DB, skillId: string) {
  const skill = db.select().from(t.skills).where(eq(t.skills.id, skillId)).get()!;
  const types = db.select().from(t.measurementTypes).where(eq(t.measurementTypes.skillId, skillId)).all();
  const assessments = db
    .select()
    .from(t.assessments)
    .where(and(eq(t.assessments.skillId, skillId), isNull(t.assessments.deletedAt)))
    .all()
    .sort((a, b) => a.assessedAt - b.assessedAt || a.createdAt - b.createdAt);
  const p = proficiency(skill.proficiencyModel, skill.primaryMeasurementTypeId, types, assessments);
  const percentTypes = new Map(types.filter((m) => m.valueKind === "percent").map((m) => [m.id, m]));
  const recentTests = assessments
    .filter((a) => percentTypes.has(a.measurementTypeId) && !a.notRepresentative)
    .map((a) => normalize(percentTypes.get(a.measurementTypeId)!, a.rawValue, a.rawLabel))
    .filter((v): v is number => v !== null)
    .slice(-3);
  return { skill, score: p.score, grade: gradeFor(p.score, getProfile(db).gradeBands), recentTests };
}

/** Days left to revise: today through the day before the test, plus the test day if it's in the afternoon. */
function daysToRevise(db: DB, startAt: number, now: number) {
  const zone = getProfile(db).timezone;
  const testDay = new Date(startAt).toLocaleDateString("en-CA", { timeZone: zone });
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(new Date(startAt)));
  return Math.max(1, daysBetween(todayKey(db, now), testDay) + (hour >= 12 ? 1 : 0));
}

export function revisionPlanFor(db: DB, test: { skillId: string; kind: keyof typeof TEST_KINDS; startAt: number }, now = Date.now()): RevisionPlan {
  const st = subjectStanding(db, test.skillId);
  return planRevision({ subject: st.skill.name, kind: test.kind, grade: st.grade, score: st.score, recentTests: st.recentTests, daysAvailable: daysToRevise(db, test.startAt, now) });
}

function questCompleted(db: DB, questId: string) {
  return !!db.select().from(t.questCompletions).where(eq(t.questCompletions.questId, questId)).get();
}

/** Removes a test's revision quest unless it was already completed (its reward stays earned). */
function removeRevisionQuest(db: DB, testId: string) {
  const x = db.select().from(t.tests).where(eq(t.tests.id, testId)).get();
  if (!x?.revisionQuestId) return;
  const q = db.select().from(t.quests).where(eq(t.quests.id, x.revisionQuestId)).get();
  if (q && !questCompleted(db, q.id)) deleteQuest(db, q.id);
  db.update(t.tests).set({ revisionQuestId: q && questCompleted(db, q.id) ? q.id : null }).where(eq(t.tests.id, testId)).run();
}

/**
 * Creates (or recreates, after an edit) the revision quest for a test. The
 * plan is sized once, when the test is added or changed, so the target
 * doesn't move under Ryu's feet when a new result comes in. Study sessions in
 * the subject (including homework ticked off with time) count from the moment
 * the test was added until it starts.
 */
export function syncRevisionQuest(db: DB, testId: string, now = Date.now()) {
  const x = db.select().from(t.tests).where(eq(t.tests.id, testId)).get();
  if (!x) return null;
  if (x.revisionQuestId && questCompleted(db, x.revisionQuestId)) return null;
  removeRevisionQuest(db, testId);
  if (x.startAt <= now) return null;
  const st = subjectStanding(db, x.skillId);
  const plan = revisionPlanFor(db, x, now);
  const filter = { skillIds: [x.skillId], includeSubskills: true, ...(st.skill.attributeId === "academics" ? { activityTypeIds: ["study"] } : {}) };
  const quest = createQuest(db, {
    title: `Revise: ${x.title}`,
    description: plan.reason,
    kind: "long_term",
    startAt: Math.min(x.createdAt, now),
    endAt: x.startAt,
    rewardXp: plan.minutes,
    origin: "generated",
    skills: [{ skillId: x.skillId, weight: 100 }],
    requirements: [
      { type: "duration", target: plan.minutes, title: `${plan.minutes} min of ${st.skill.name} study`, filter },
      ...(plan.days > 1 ? [{ type: "distinct_days" as const, target: plan.days, title: `on ${plan.days} different days`, filter }] : []),
    ],
  });
  db.update(t.tests).set({ revisionQuestId: quest.id }).where(eq(t.tests.id, testId)).run();
  return { questId: quest.id, plan };
}

/** For tests added before revision quests existed. */
export function backfillRevisionQuests(db: DB, now = Date.now()) {
  for (const x of db.select().from(t.tests).all()) if (!x.revisionQuestId && x.startAt > now) syncRevisionQuest(db, x.id, now);
}
