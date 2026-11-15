/** Assessments, quests, medals and formula versions. */
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DB, Tx } from "@/db/client";
import * as t from "@/db/schema";
import { normalize } from "@/domain/proficiency";
import { periodKey as periodKeyOf, periodRange } from "@/domain/time";
import type { FormulaParams } from "@/domain/types";
import { assessmentInput, medalAwardInput, questInput, requirementInput, type AssessmentInput, type MedalAwardInput, type QuestInput } from "@/validation/schemas";
import type { z } from "zod";
import { ChangeLog, currentFormula, getProfile, timeSettings } from "./context";
import { autoJournalBody, completionSourceId, dryRun, Facts, reconcileAfterAssessment, reconcileAll, reconcileHonors, reconcileQuest } from "./engine";
import { ValidationError, parse } from "./errors";

// ------------------------------------------------------------ assessments ---

function checkAssessment(tx: Tx, a: z.output<typeof assessmentInput>) {
  const mt = tx.select().from(t.measurementTypes).where(eq(t.measurementTypes.id, a.measurementTypeId)).get();
  if (!mt) throw ValidationError.one("measurementTypeId", "Unknown measurement type");
  if (mt.skillId !== a.skillId) throw ValidationError.one("measurementTypeId", "That measurement belongs to another skill");
  if (normalize(mt, a.rawValue ?? null, a.rawLabel ?? null) === null) {
    throw ValidationError.one("rawValue", mt.valueKind === "grade" ? "Pick a result from the list" : "Enter a number");
  }
  return mt;
}

export function createAssessment(db: DB, input: AssessmentInput): typeof t.assessments.$inferSelect {
  const a = parse(assessmentInput, input);
  return db.transaction((tx) => {
    const mt = checkAssessment(tx, a);
    const row = tx
      .insert(t.assessments)
      .values({
        id: a.id ?? randomUUID(),
        skillId: a.skillId,
        measurementTypeId: mt.id,
        assessedAt: a.assessedAt,
        rawValue: a.rawValue ?? null,
        rawLabel: a.rawLabel ?? null,
        method: a.method,
        notes: a.notes ?? null,
        evidence: a.evidence ?? null,
        activityId: a.activityId ?? null,
        notRepresentative: a.notRepresentative,
        notRepresentativeReason: a.notRepresentativeReason ?? null,
        source: a.source,
        isSample: a.isSample,
      })
      .returning()
      .get();
    reconcileAfterAssessment(tx, mt.id, [a.assessedAt]);
    return row;
  });
}

export function updateAssessment(db: DB, id: string, patch: Partial<AssessmentInput>) {
  return db.transaction((tx) => {
    const old = tx.select().from(t.assessments).where(eq(t.assessments.id, id)).get();
    if (!old || old.deletedAt !== null) throw ValidationError.one("id", "Assessment not found");
    const merged = parse(assessmentInput, { ...old, ...patch, id: undefined });
    const mt = checkAssessment(tx, merged);
    tx.insert(t.revisions).values({ entityType: "assessment", entityId: id, revision: old.revision, snapshot: { ...old } }).run();
    const row = tx
      .update(t.assessments)
      .set({
        measurementTypeId: mt.id,
        assessedAt: merged.assessedAt,
        rawValue: merged.rawValue ?? null,
        rawLabel: merged.rawLabel ?? null,
        method: merged.method,
        notes: merged.notes ?? null,
        evidence: merged.evidence ?? null,
        notRepresentative: merged.notRepresentative,
        notRepresentativeReason: merged.notRepresentativeReason ?? null,
        revision: old.revision + 1,
      })
      .where(eq(t.assessments.id, id))
      .returning()
      .get();
    const log = reconcileAfterAssessment(tx, old.measurementTypeId, [old.assessedAt, merged.assessedAt]);
    if (mt.id !== old.measurementTypeId) reconcileAfterAssessment(tx, mt.id, [merged.assessedAt], log);
    return row;
  });
}

export function deleteAssessment(db: DB, id: string, now = Date.now()) {
  db.transaction((tx) => {
    const a = tx.select().from(t.assessments).where(eq(t.assessments.id, id)).get();
    if (!a || a.deletedAt !== null) return;
    tx.update(t.assessments).set({ deletedAt: now }).where(eq(t.assessments.id, id)).run();
    reconcileAfterAssessment(tx, a.measurementTypeId, [a.assessedAt]);
  });
}

export function restoreAssessment(db: DB, id: string) {
  db.transaction((tx) => {
    const a = tx.select().from(t.assessments).where(eq(t.assessments.id, id)).get();
    if (!a || a.deletedAt === null) return;
    tx.update(t.assessments).set({ deletedAt: null }).where(eq(t.assessments.id, id)).run();
    reconcileAfterAssessment(tx, a.measurementTypeId, [a.assessedAt]);
  });
}

// ----------------------------------------------------------------- quests ---

/** Rejects prerequisite or sub-quest links that would create a cycle or point at recurring quests. */
function checkQuestGraph(tx: Tx, questId: string, prerequisiteIds: string[], subQuestIds: string[]) {
  for (const id of [...prerequisiteIds, ...subQuestIds]) {
    const q = tx.select().from(t.quests).where(eq(t.quests.id, id)).get();
    if (!q) throw ValidationError.one("prerequisiteIds", `Unknown quest: ${id}`);
    if (q.kind !== "long_term") throw ValidationError.one("prerequisiteIds", `"${q.title}" repeats, so it can't be a prerequisite or sub-quest`);
  }
  const edges = new Map<string, string[]>();
  for (const p of tx.select().from(t.questPrerequisites).all()) edges.set(p.questId, [...(edges.get(p.questId) ?? []), p.requiresQuestId]);
  for (const r of tx.select().from(t.questRequirements).where(eq(t.questRequirements.type, "subquests")).all()) {
    edges.set(r.questId, [...(edges.get(r.questId) ?? []), ...(r.subQuestIds ?? [])]);
  }
  edges.set(questId, [...prerequisiteIds, ...subQuestIds]);
  const seen = new Set<string>();
  const stack = [...(edges.get(questId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === questId) throw ValidationError.one("prerequisiteIds", "That link would make the quest depend on itself");
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(edges.get(id) ?? []));
  }
}

function insertRequirements(tx: Tx, questId: string, version: number, reqs: z.output<typeof requirementInput>[]) {
  for (const r of reqs) {
    if (r.type === "assessment" && !r.measurementTypeId) throw ValidationError.one("requirements", "Assessment requirements need a measurement");
    if (r.type === "subquests" && !r.subQuestIds?.length) throw ValidationError.one("requirements", "Pick the sub-quests");
    tx.insert(t.questRequirements)
      .values({
        id: `${questId}:v${version}:${r.id ?? randomUUID().slice(0, 8)}`,
        questId,
        version,
        stageOrdinal: r.stageOrdinal,
        stageTitle: r.stageTitle ?? null,
        type: r.type,
        title: r.title ?? null,
        target: r.type === "milestone" ? 1 : r.target,
        filter: r.filter,
        measurementTypeId: r.measurementTypeId ?? null,
        subQuestIds: r.subQuestIds ?? null,
      })
      .run();
  }
}

export function createQuest(db: DB, input: QuestInput) {
  const q = parse(questInput, input);
  return db.transaction((tx) => {
    const id = q.id ?? randomUUID();
    const subs = q.requirements.flatMap((r) => r.subQuestIds ?? []);
    checkQuestGraph(tx, id, q.prerequisiteIds, subs);
    const defaults = currentFormula(tx).params.questRewardDefaults;
    const rewardXp = q.rewardXp ?? (q.kind === "daily" ? defaults.daily : q.kind === "weekly" ? defaults.weekly : 250);
    const row = tx
      .insert(t.quests)
      .values({
        id,
        title: q.title,
        description: q.description ?? null,
        kind: q.kind,
        difficulty: q.difficulty,
        startAt: q.startAt ?? null,
        endAt: q.endAt ?? null,
        rewardXp,
        status: q.status,
        parentQuestId: q.parentQuestId ?? null,
        origin: q.origin,
        isSample: q.isSample,
      })
      .returning()
      .get();
    for (const s of q.skills) tx.insert(t.questSkills).values({ questId: id, ...s }).run();
    for (const p of q.prerequisiteIds) tx.insert(t.questPrerequisites).values({ questId: id, requiresQuestId: p }).run();
    tx.insert(t.questRequirementVersions).values({ questId: id, version: 1, effectiveFrom: 0 }).run();
    insertRequirements(tx, id, 1, q.requirements);
    reconcileQuest(tx, id);
    return row;
  });
}

/**
 * Changing requirements creates a new version. Recurring quests use it from
 * the current period on, so past periods keep the rules they ran under.
 */
export function updateQuestRequirements(db: DB, questId: string, requirements: z.input<typeof requirementInput>[], now = Date.now()) {
  const reqs = requirements.map((r) => parse(requirementInput, r));
  if (!reqs.length) throw ValidationError.one("requirements", "A quest needs at least one requirement");
  db.transaction((tx) => {
    const q = tx.select().from(t.quests).where(eq(t.quests.id, questId)).get();
    if (!q) throw ValidationError.one("id", "Quest not found");
    checkQuestGraph(
      tx,
      questId,
      tx.select().from(t.questPrerequisites).where(eq(t.questPrerequisites.questId, questId)).all().map((p) => p.requiresQuestId),
      reqs.flatMap((r) => r.subQuestIds ?? []),
    );
    const versions = tx.select().from(t.questRequirementVersions).where(eq(t.questRequirementVersions.questId, questId)).all();
    const version = Math.max(0, ...versions.map((v) => v.version)) + 1;
    const ts = timeSettings(getProfile(tx));
    const effectiveFrom = q.kind === "long_term" ? 0 : periodRange(q.kind, periodKeyOf(q.kind, now, ts), ts).start;
    tx.insert(t.questRequirementVersions).values({ questId, version, effectiveFrom }).run();
    insertRequirements(tx, questId, version, reqs);
    reconcileQuest(tx, questId);
  });
}

function refreshJournalFor(tx: Tx, activityIds: string[]) {
  if (!activityIds.length) return;
  const facts = new Facts(tx);
  for (const id of new Set(activityIds)) {
    const entry = tx.select().from(t.journalEntries).where(eq(t.journalEntries.id, `auto:${id}`)).get();
    const a = facts.activityRows().get(id);
    if (!entry || entry.userEdited || !a || a.deletedAt !== null) continue;
    const body = autoJournalBody(tx, facts, a);
    if (body !== entry.body) tx.update(t.journalEntries).set({ body }).where(eq(t.journalEntries.id, entry.id)).run();
  }
}

export function updateQuest(
  db: DB,
  questId: string,
  patch: Partial<Pick<QuestInput, "title" | "description" | "rewardXp" | "startAt" | "endAt" | "difficulty">> & {
    skills?: { skillId: string; weight: number }[];
    prerequisiteIds?: string[];
  },
) {
  db.transaction((tx) => {
    const q = tx.select().from(t.quests).where(eq(t.quests.id, questId)).get();
    if (!q) throw ValidationError.one("id", "Quest not found");
    if (patch.prerequisiteIds) {
      checkQuestGraph(tx, questId, patch.prerequisiteIds, []);
      tx.delete(t.questPrerequisites).where(eq(t.questPrerequisites.questId, questId)).run();
      for (const p of patch.prerequisiteIds) tx.insert(t.questPrerequisites).values({ questId, requiresQuestId: p }).run();
    }
    if (patch.skills) {
      tx.delete(t.questSkills).where(eq(t.questSkills.questId, questId)).run();
      for (const s of patch.skills) tx.insert(t.questSkills).values({ questId, ...s }).run();
    }
    const { skills: _s, prerequisiteIds: _p, ...fields } = patch;
    void _s;
    void _p;
    if (Object.keys(fields).length) tx.update(t.quests).set(fields).where(eq(t.quests.id, questId)).run();
    // The reconcile re-posts reward XP for every completion, so rewards follow the new size and skills.
    reconcileQuest(tx, questId);
    refreshJournalFor(
      tx,
      tx.select().from(t.questContributions).where(eq(t.questContributions.questId, questId)).all().map((c) => c.activityId),
    );
  });
}

export function setQuestStatus(db: DB, questId: string, status: "proposed" | "active" | "archived", now = Date.now()) {
  db.transaction((tx) => {
    const q = tx.select().from(t.quests).where(eq(t.quests.id, questId)).get();
    if (!q) throw ValidationError.one("id", "Quest not found");
    tx.update(t.quests)
      .set({ status, archivedAt: status === "archived" ? (q.archivedAt ?? now) : null })
      .where(eq(t.quests.id, questId))
      .run();
    reconcileQuest(tx, questId);
  });
}

/** Removes a quest entirely (for dismissing proposals or cleaning up). Its rewards are reversed. */
export function deleteQuest(db: DB, questId: string) {
  db.transaction((tx) => {
    const reqIds = tx.select().from(t.questRequirements).where(eq(t.questRequirements.questId, questId)).all().map((r) => r.id);
    const affected = tx.select().from(t.questContributions).where(eq(t.questContributions.questId, questId)).all().map((c) => c.activityId);
    for (const table of [t.questSkills, t.questRequirementVersions, t.questRequirements] as const) {
      tx.delete(table).where(eq(table.questId, questId)).run();
    }
    tx.delete(t.questPrerequisites).where(eq(t.questPrerequisites.questId, questId)).run();
    if (reqIds.length) tx.delete(t.milestoneChecks).where(inArray(t.milestoneChecks.requirementId, reqIds)).run();
    tx.delete(t.quests).where(eq(t.quests.id, questId)).run();
    reconcileAll(tx);
    refreshJournalFor(tx, affected);
  });
}

export function setMilestone(db: DB, requirementId: string, periodKey: string, checked: boolean, now = Date.now()) {
  db.transaction((tx) => {
    const r = tx.select().from(t.questRequirements).where(eq(t.questRequirements.id, requirementId)).get();
    if (!r || r.type !== "milestone") throw ValidationError.one("requirementId", "Milestone not found");
    if (checked) {
      tx.insert(t.milestoneChecks).values({ requirementId, periodKey, checkedAt: now }).onConflictDoNothing().run();
    } else {
      tx.delete(t.milestoneChecks).where(and(eq(t.milestoneChecks.requirementId, requirementId), eq(t.milestoneChecks.periodKey, periodKey))).run();
    }
    reconcileQuest(tx, r.questId);
  });
}

// ----------------------------------------------------------------- medals ---

export function awardMedal(db: DB, input: MedalAwardInput) {
  const a = parse(medalAwardInput, input);
  return db.transaction((tx) => {
    const medal = tx.select().from(t.medals).where(eq(t.medals.id, a.medalId)).get();
    if (!medal) throw ValidationError.one("medalId", "Unknown medal");
    if (medal.awardRule !== "manual") throw ValidationError.one("medalId", "This medal is awarded automatically");
    const existing = tx.select().from(t.medalAwards).where(eq(t.medalAwards.medalId, medal.id)).all();
    if (!medal.repeatable && existing.length) throw ValidationError.one("medalId", "This medal has already been awarded");
    if (existing.some((e) => e.occasionKey === a.occasionKey)) {
      // Same occasion submitted again: return the existing award instead of a duplicate.
      return existing.find((e) => e.occasionKey === a.occasionKey)!;
    }
    if (a.skillsOverride && a.skillsOverride.reduce((s, k) => s + k.weight, 0) !== 100) {
      throw ValidationError.one("skillsOverride", "Skill weights must add up to 100%");
    }
    const row = tx
      .insert(t.medalAwards)
      .values({
        id: a.id ?? randomUUID(),
        medalId: medal.id,
        occasionKey: a.occasionKey,
        occasion: a.occasion ?? null,
        awardedAt: a.awardedAt,
        origin: "manual",
        tierOverride: a.tierOverride ?? null,
        xpOverride: a.xpOverride ?? null,
        skillsOverride: a.skillsOverride ?? null,
        evidence: a.evidence ?? null,
        notes: a.notes ?? null,
        source: a.source,
        isSample: a.isSample,
      })
      .returning()
      .get();
    reconcileHonors(tx);
    return row;
  });
}

export function removeMedalAward(db: DB, awardId: string) {
  db.transaction((tx) => {
    const a = tx.select().from(t.medalAwards).where(eq(t.medalAwards.id, awardId)).get();
    if (!a) return;
    if (a.origin !== "manual") throw ValidationError.one("id", "Linked medals follow their quest or assessment and can't be removed by hand");
    tx.delete(t.medalAwards).where(eq(t.medalAwards.id, awardId)).run();
    reconcileHonors(tx);
  });
}

// ---------------------------------------------------------------- formula ---

/** Saves new progression settings as a new formula version. Existing activities keep theirs. */
export function saveFormula(db: DB, params: FormulaParams): number {
  return db.transaction((tx) => {
    const row = tx.insert(t.formulaVersions).values({ params }).returning().get();
    tx.update(t.profile).set({ currentFormulaVersionId: row.id }).where(eq(t.profile.id, 1)).run();
    reconcileHonors(tx); // medal tier XP and level achievements read the current formula
    return row.id;
  });
}

function recalc(tx: Tx, log: ChangeLog) {
  const current = getProfile(tx).currentFormulaVersionId;
  tx.update(t.activities).set({ formulaVersionId: current }).run();
  reconcileAll(tx, log);
}

/** What "Recalculate all with current formula" would change, without changing anything. */
export function previewRecalculate(db: DB): { characterDelta: number; changes: number } {
  let delta = 0;
  const items = dryRun(db, (tx, log) => recalc(tx, log));
  for (const i of items) {
    const m = /^xp activity:\S+ character ([+-]?\d+)$/.exec(i);
    if (m) delta += Number(m[1]);
  }
  return { characterDelta: delta, changes: items.length };
}

export function recalculateAll(db: DB): ChangeLog {
  return db.transaction((tx) => {
    const log = new ChangeLog();
    recalc(tx, log);
    return log;
  });
}
