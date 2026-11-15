/** Creating, editing, deleting and quick-logging activities. Every change runs the reconcile. */
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DB, Tx } from "@/db/client";
import * as t from "@/db/schema";
import { computeXp, type XpBreakdown } from "@/domain/xp";
import { activityInput, type ActivityInput } from "@/validation/schemas";
import { ChangeLog, currentFormula } from "./context";
import { reconcileAfterActivity, reconcileAfterAssessment } from "./engine";
import { ValidationError, parse } from "./errors";

type ActivityRow = typeof t.activities.$inferSelect;

const FUTURE_TOLERANCE_MS = 5 * 60_000;
const DUPLICATE_WINDOW_MS = 10 * 60_000;

export interface SaveResult {
  activity: ActivityRow;
  /** False when an identical request was already saved (double-click, retry, re-import). */
  created: boolean;
  xp: number;
  changes: ChangeLog;
}

function checkReferences(tx: Tx, a: { activityTypeId: string; skills: { skillId: string }[] }) {
  if (!tx.select().from(t.activityTypes).where(eq(t.activityTypes.id, a.activityTypeId)).get()) {
    throw ValidationError.one("activityTypeId", "Unknown activity type");
  }
  for (const s of a.skills) {
    const skill = tx.select().from(t.skills).where(eq(t.skills.id, s.skillId)).get();
    if (!skill) throw ValidationError.one("skills", `Unknown skill: ${s.skillId}`);
    if (skill.kind === "trait") throw ValidationError.one("skills", `${skill.name} is computed from your habits and can't be logged directly`);
  }
}

function activityXp(tx: Tx, a: ActivityRow): number {
  return tx
    .select()
    .from(t.xpEntries)
    .where(and(eq(t.xpEntries.sourceType, "activity"), eq(t.xpEntries.sourceId, a.id), eq(t.xpEntries.targetType, "character")))
    .all()
    .reduce((s, e) => s + e.amount, 0);
}

export function createActivity(db: DB, input: ActivityInput, now = Date.now()): SaveResult {
  const a = parse(activityInput, input);
  if (a.startAt > now + FUTURE_TOLERANCE_MS) {
    throw ValidationError.one("startAt", "That time is in the future. Planned sessions belong in the calendar.");
  }
  return db.transaction((tx) => {
    if (a.clientRequestId) {
      const dup = tx.select().from(t.activities).where(eq(t.activities.clientRequestId, a.clientRequestId)).get();
      if (dup) return { activity: dup, created: false, xp: activityXp(tx, dup), changes: new ChangeLog() };
    }
    if (a.externalId) {
      const dup = tx
        .select()
        .from(t.activities)
        .where(and(eq(t.activities.source, a.source), eq(t.activities.externalId, a.externalId)))
        .get();
      if (dup) return { activity: dup, created: false, xp: activityXp(tx, dup), changes: new ChangeLog() };
    }
    checkReferences(tx, a);
    const id = randomUUID();
    const row = tx
      .insert(t.activities)
      .values({
        id,
        clientRequestId: a.clientRequestId ?? null,
        name: a.name,
        notes: a.notes ?? null,
        startAt: a.startAt,
        durationMin: a.durationMin,
        activityTypeId: a.activityTypeId,
        difficulty: a.difficulty,
        source: a.source,
        externalId: a.externalId ?? null,
        templateId: a.templateId ?? null,
        formulaVersionId: currentFormula(tx).id,
        isSample: a.isSample,
      })
      .returning()
      .get();
    for (const s of a.skills) tx.insert(t.activitySkills).values({ activityId: id, skillId: s.skillId, weight: s.weight }).run();
    if (a.templateId) tx.update(t.activityTemplates).set({ lastUsedAt: now }).where(eq(t.activityTemplates.id, a.templateId)).run();

    const changes = reconcileAfterActivity(tx, id, [a.startAt]);

    // Measured results become assessments only when the user ticks "record as assessment".
    for (const r of a.results.filter((x) => x.recordAsAssessment)) {
      const mt = tx.select().from(t.measurementTypes).where(eq(t.measurementTypes.id, r.measurementTypeId)).get();
      if (!mt) throw ValidationError.one("results", "Unknown measurement type");
      tx.insert(t.assessments)
        .values({
          id: randomUUID(),
          skillId: mt.skillId,
          measurementTypeId: mt.id,
          assessedAt: a.startAt,
          rawValue: r.rawValue ?? null,
          rawLabel: r.rawLabel ?? null,
          method: "benchmark",
          activityId: id,
          isSample: a.isSample,
        })
        .run();
      reconcileAfterAssessment(tx, mt.id, [a.startAt], changes);
    }
    return { activity: row, created: true, xp: activityXp(tx, row), changes };
  });
}

export type ActivityPatch = Partial<Omit<ActivityInput, "clientRequestId" | "externalId" | "source" | "results" | "isSample">>;

export function updateActivity(db: DB, id: string, patch: ActivityPatch, now = Date.now()): SaveResult {
  return db.transaction((tx) => {
    const old = tx.select().from(t.activities).where(eq(t.activities.id, id)).get();
    if (!old || old.deletedAt !== null) throw ValidationError.one("id", "Activity not found");
    const oldSkills = tx.select().from(t.activitySkills).where(eq(t.activitySkills.activityId, id)).all();
    const merged = parse(activityInput, {
      name: patch.name ?? old.name,
      notes: patch.notes !== undefined ? patch.notes : old.notes,
      startAt: patch.startAt ?? old.startAt,
      durationMin: patch.durationMin ?? old.durationMin,
      activityTypeId: patch.activityTypeId ?? old.activityTypeId,
      difficulty: patch.difficulty ?? old.difficulty,
      skills: patch.skills ?? oldSkills.map((s) => ({ skillId: s.skillId, weight: s.weight })),
      templateId: patch.templateId !== undefined ? patch.templateId : old.templateId,
      confirmLong: patch.confirmLong ?? true,
    });
    if (merged.startAt > now + FUTURE_TOLERANCE_MS) throw ValidationError.one("startAt", "That time is in the future.");
    checkReferences(tx, merged);

    tx.insert(t.revisions)
      .values({ entityType: "activity", entityId: id, revision: old.revision, snapshot: { ...old, skills: oldSkills } })
      .run();
    const row = tx
      .update(t.activities)
      .set({
        name: merged.name,
        notes: merged.notes ?? null,
        startAt: merged.startAt,
        durationMin: merged.durationMin,
        activityTypeId: merged.activityTypeId,
        difficulty: merged.difficulty,
        templateId: merged.templateId ?? null,
        revision: old.revision + 1,
        updatedAt: now,
      })
      .where(eq(t.activities.id, id))
      .returning()
      .get();
    tx.delete(t.activitySkills).where(eq(t.activitySkills.activityId, id)).run();
    for (const s of merged.skills) tx.insert(t.activitySkills).values({ activityId: id, skillId: s.skillId, weight: s.weight }).run();
    const changes = reconcileAfterActivity(tx, id, [old.startAt, merged.startAt], new ChangeLog(), { revisionChanged: true });
    return { activity: row, created: false, xp: activityXp(tx, row), changes };
  });
}

/** Soft delete. Undo with restoreActivity. */
export function deleteActivity(db: DB, id: string, now = Date.now()): ChangeLog {
  return db.transaction((tx) => {
    const a = tx.select().from(t.activities).where(eq(t.activities.id, id)).get();
    if (!a) throw ValidationError.one("id", "Activity not found");
    if (a.deletedAt !== null) return new ChangeLog();
    tx.update(t.activities).set({ deletedAt: now }).where(eq(t.activities.id, id)).run();
    return reconcileAfterActivity(tx, id, [a.startAt]);
  });
}

export function restoreActivity(db: DB, id: string): ChangeLog {
  return db.transaction((tx) => {
    const a = tx.select().from(t.activities).where(eq(t.activities.id, id)).get();
    if (!a) throw ValidationError.one("id", "Activity not found");
    if (a.deletedAt === null) return new ChangeLog();
    tx.update(t.activities).set({ deletedAt: null }).where(eq(t.activities.id, id)).run();
    return reconcileAfterActivity(tx, id, [a.startAt]);
  });
}

/** An existing activity with the same name and duration within 10 minutes, if any. */
export function findLikelyDuplicate(db: DB, a: { name: string; durationMin: number; startAt: number }): ActivityRow | null {
  const rows = db
    .select()
    .from(t.activities)
    .where(
      and(
        isNull(t.activities.deletedAt),
        eq(t.activities.durationMin, a.durationMin),
        gte(t.activities.startAt, a.startAt - DUPLICATE_WINDOW_MS),
        lte(t.activities.startAt, a.startAt + DUPLICATE_WINDOW_MS),
      ),
    )
    .all();
  return rows.find((r) => r.name.trim().toLowerCase() === a.name.trim().toLowerCase()) ?? null;
}

/** XP preview for the log form, using the current formula. */
export function previewXp(db: DB, a: { durationMin: number; difficulty: string; activityTypeId: string }): XpBreakdown {
  return computeXp(a, currentFormula(db).params);
}

// ----------------------------------------------------------- quick log ---

/** One tap on a tile: logs the template with its defaults, ending now. */
export function logTemplate(
  db: DB,
  templateId: string,
  opts: { now?: number; durationMin?: number; startAt?: number; clientRequestId?: string; source?: "manual" | "timer" | "inbox"; isSample?: boolean } = {},
): SaveResult {
  const now = opts.now ?? Date.now();
  const tpl = db.select().from(t.activityTemplates).where(eq(t.activityTemplates.id, templateId)).get();
  if (!tpl) throw ValidationError.one("templateId", "Template not found");
  const durationMin = opts.durationMin ?? tpl.durationMin;
  return createActivity(
    db,
    {
      name: tpl.name,
      startAt: opts.startAt ?? now - durationMin * 60_000,
      durationMin,
      activityTypeId: tpl.activityTypeId,
      difficulty: tpl.difficulty as ActivityInput["difficulty"],
      skills: tpl.skills,
      templateId: tpl.id,
      source: opts.source ?? "manual",
      clientRequestId: opts.clientRequestId ?? null,
      isSample: opts.isSample ?? false,
      confirmLong: true,
    },
    now,
  );
}

export function startTimer(db: DB, templateId: string, now = Date.now()) {
  return db.transaction((tx) => {
    if (!tx.select().from(t.activityTemplates).where(eq(t.activityTemplates.id, templateId)).get()) {
      throw ValidationError.one("templateId", "Template not found");
    }
    if (tx.select().from(t.activeTimer).get()) throw ValidationError.one("timer", "A timer is already running. Stop it first.");
    return tx.insert(t.activeTimer).values({ id: 1, templateId, startedAt: now }).returning().get();
  });
}

export function getTimer(db: DB) {
  return db.select().from(t.activeTimer).get() ?? null;
}

export function cancelTimer(db: DB) {
  db.delete(t.activeTimer).run();
}

/**
 * Stops the timer and logs the session. A timer left running for over 4 hours
 * is probably forgotten, so it needs confirmation like any long session.
 */
export function stopTimer(db: DB, opts: { now?: number; clientRequestId?: string; confirmLong?: boolean } = {}): SaveResult {
  const now = opts.now ?? Date.now();
  const timer = getTimer(db);
  if (!timer) throw ValidationError.one("timer", "No timer is running");
  const durationMin = Math.max(1, Math.round((now - timer.startedAt) / 60_000));
  const tpl = db.select().from(t.activityTemplates).where(eq(t.activityTemplates.id, timer.templateId)).get();
  if (!tpl) throw ValidationError.one("templateId", "Template not found");
  const res = createActivity(
    db,
    {
      name: tpl.name,
      startAt: timer.startedAt,
      durationMin: Math.min(durationMin, 480),
      activityTypeId: tpl.activityTypeId,
      difficulty: tpl.difficulty as ActivityInput["difficulty"],
      skills: tpl.skills,
      templateId: tpl.id,
      source: "timer",
      clientRequestId: opts.clientRequestId ?? `timer:${timer.startedAt}`,
      confirmLong: opts.confirmLong ?? false,
    },
    now,
  );
  cancelTimer(db);
  return res;
}
