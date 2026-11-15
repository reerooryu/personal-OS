/**
 * The reconcile engine.
 *
 * Every derived record (XP ledger, quest contributions and completions, linked
 * medal awards, achievement unlocks, automatic journal entries) is computed
 * from source records. Reconciling compares what should exist with what does
 * exist and writes only the difference, so running it twice writes nothing.
 *
 * reconcileAfterActivity() handles one changed activity. reconcileAll()
 * recomputes everything, and verify() runs reconcileAll() in a rolled-back
 * transaction: any change it would make is a bug in the scoped path.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DB, Tx } from "@/db/client";
import * as t from "@/db/schema";
import { normalize, type MeasurementTypeDef } from "@/domain/proficiency";
import { evaluateQuest, type ActivityFact, type QuestEvaluation, type RequirementDef } from "@/domain/quests";
import { dayKey, periodKey as periodKeyOf, periodRange, type TimeSettings } from "@/domain/time";
import { firstCrossing, streaks } from "@/domain/traits";
import { DIFFICULTY_LABELS, type Difficulty, type MedalTier, type WeightedSkill } from "@/domain/types";
import { computeXp, levelFromXp, splitByWeights } from "@/domain/xp";
import {
  ChangeLog,
  currentFormula,
  getFormula,
  getProfile,
  loadSkillTree,
  timeSettings,
  type Profile,
  type SkillTree,
} from "./context";
import { CHARACTER, ledgerSourceIds, postDiff, skillKey, type Expected } from "./ledger";

type ActivityRow = typeof t.activities.$inferSelect;
type QuestRow = typeof t.quests.$inferSelect;

interface ScoredAssessment {
  id: string;
  skillId: string;
  measurementTypeId: string;
  at: number;
  score: number;
}

/** Facts loaded once per reconcile run. */
export class Facts {
  readonly profile: Profile;
  readonly ts: TimeSettings;
  readonly tree: SkillTree;
  private _activities?: ActivityFact[];
  private _activityRows?: Map<string, ActivityRow>;
  private _assessments?: ScoredAssessment[];
  private _measurementTypes?: Map<string, MeasurementTypeDef>;

  constructor(readonly tx: Tx) {
    this.profile = getProfile(tx);
    this.ts = timeSettings(this.profile);
    this.tree = loadSkillTree(tx);
  }

  activityRows(): Map<string, ActivityRow> {
    if (!this._activityRows) {
      this._activityRows = new Map(this.tx.select().from(t.activities).all().map((a) => [a.id, a]));
    }
    return this._activityRows;
  }

  /** Live (not deleted) activities, oldest first. */
  activities(): ActivityFact[] {
    if (!this._activities) {
      const skills = new Map<string, WeightedSkill[]>();
      for (const s of this.tx.select().from(t.activitySkills).all()) {
        skills.set(s.activityId, [...(skills.get(s.activityId) ?? []), { skillId: s.skillId, weight: s.weight }]);
      }
      this._activities = [...this.activityRows().values()]
        .filter((a) => a.deletedAt === null)
        .map((a) => ({
          id: a.id,
          startAt: a.startAt,
          durationMin: a.durationMin,
          activityTypeId: a.activityTypeId,
          difficulty: a.difficulty,
          skills: skills.get(a.id) ?? [],
          dayKey: dayKey(a.startAt, this.ts),
        }))
        .sort((x, y) => x.startAt - y.startAt || (x.id < y.id ? -1 : 1));
    }
    return this._activities;
  }

  measurementTypes(): Map<string, MeasurementTypeDef> {
    if (!this._measurementTypes) {
      this._measurementTypes = new Map(this.tx.select().from(t.measurementTypes).all().map((m) => [m.id, m]));
    }
    return this._measurementTypes;
  }

  /** Live, representative assessments with a 0-100 score. */
  assessments(): ScoredAssessment[] {
    if (!this._assessments) {
      const types = this.measurementTypes();
      this._assessments = this.tx
        .select()
        .from(t.assessments)
        .where(and(isNull(t.assessments.deletedAt), eq(t.assessments.notRepresentative, false)))
        .all()
        .flatMap((a) => {
          const mt = types.get(a.measurementTypeId);
          const score = mt ? normalize(mt, a.rawValue, a.rawLabel) : null;
          return score === null ? [] : [{ id: a.id, skillId: a.skillId, measurementTypeId: a.measurementTypeId, at: a.assessedAt, score }];
        });
    }
    return this._assessments;
  }
}

// ------------------------------------------------------------ activity XP ---

export function expectedActivityXp(tx: Tx, a: ActivityRow | undefined, skills: WeightedSkill[]): Map<string, Expected> {
  const out = new Map<string, Expected>();
  if (!a || a.deletedAt !== null) return out;
  const b = computeXp({ durationMin: a.durationMin, difficulty: a.difficulty, activityTypeId: a.activityTypeId }, getFormula(tx, a.formulaVersionId));
  out.set(CHARACTER, { amount: b.total, breakdown: { ...b } });
  if (b.total > 0 && skills.length) {
    for (const [skillId, amount] of splitByWeights(b.total, skills)) {
      const weight = skills.find((s) => s.skillId === skillId)?.weight ?? 0;
      out.set(skillKey(skillId), { amount, breakdown: { ...b, skillWeight: weight, share: amount } });
    }
  }
  return out;
}

function reconcileActivityXp(tx: Tx, activityId: string, log: ChangeLog): void {
  const a = tx.select().from(t.activities).where(eq(t.activities.id, activityId)).get();
  const skills = tx
    .select()
    .from(t.activitySkills)
    .where(eq(t.activitySkills.activityId, activityId))
    .all()
    .map((s) => ({ skillId: s.skillId, weight: s.weight }));
  postDiff(tx, "activity", activityId, expectedActivityXp(tx, a, skills), a?.formulaVersionId ?? null, log);
}

// ----------------------------------------------------------------- quests ---

function requirementVersion(tx: Tx, quest: QuestRow, windowStart: number): number {
  const versions = tx
    .select()
    .from(t.questRequirementVersions)
    .where(eq(t.questRequirementVersions.questId, quest.id))
    .all()
    .sort((a, b) => a.version - b.version);
  if (versions.length === 0) return 1;
  if (quest.kind === "long_term") return versions.at(-1)!.version;
  const applicable = versions.filter((v) => v.effectiveFrom <= windowStart);
  return (applicable.at(-1) ?? versions[0]!).version;
}

export function loadRequirements(tx: Tx, facts: Facts, quest: QuestRow, windowStart: number): RequirementDef[] {
  const version = requirementVersion(tx, quest, windowStart);
  return tx
    .select()
    .from(t.questRequirements)
    .where(and(eq(t.questRequirements.questId, quest.id), eq(t.questRequirements.version, version)))
    .all()
    .sort((a, b) => a.stageOrdinal - b.stageOrdinal || (a.id < b.id ? -1 : 1))
    .map((r) => {
      let matchSkills: Set<string> | null = null;
      if (r.filter.skillIds?.length) {
        matchSkills = new Set<string>();
        for (const id of r.filter.skillIds) {
          for (const s of r.filter.includeSubskills === false ? [id] : facts.tree.withDescendants(id)) matchSkills.add(s);
        }
      }
      return {
        id: r.id,
        stageOrdinal: r.stageOrdinal,
        stageTitle: r.stageTitle,
        type: r.type,
        title: r.title,
        target: r.target,
        filter: r.filter,
        matchSkills,
        measurementTypeId: r.measurementTypeId,
        subQuestIds: r.subQuestIds,
      };
    });
}

export interface PeriodEvaluation {
  locked: boolean;
  window: { start: number; end: number };
  evaluation: QuestEvaluation | null;
  requirements: RequirementDef[];
}

/** Evaluates one quest for one period. Proposed quests are never evaluated. */
export function evaluateQuestPeriod(tx: Tx, facts: Facts, quest: QuestRow, key: string): PeriodEvaluation {
  const empty = (locked: boolean, window = { start: 0, end: 0 }): PeriodEvaluation => ({ locked, window, evaluation: null, requirements: [] });
  if (quest.status === "proposed") return empty(false);

  const range = periodRange(quest.kind, key, facts.ts);
  let start = Math.max(range.start, quest.startAt ?? Number.NEGATIVE_INFINITY);
  const end = Math.min(range.end, quest.endAt ?? Number.POSITIVE_INFINITY, quest.archivedAt ?? Number.POSITIVE_INFINITY);

  const prereqs = tx.select().from(t.questPrerequisites).where(eq(t.questPrerequisites.questId, quest.id)).all();
  for (const p of prereqs) {
    const done = tx
      .select()
      .from(t.questCompletions)
      .where(and(eq(t.questCompletions.questId, p.requiresQuestId), eq(t.questCompletions.periodKey, "once")))
      .get();
    if (!done) return empty(true, { start, end });
    start = Math.max(start, done.completedAt);
  }
  if (start >= end) return empty(false, { start, end });

  const requirements = loadRequirements(tx, facts, quest, Number.isFinite(range.start) ? range.start : (quest.startAt ?? 0));
  const reqIds = requirements.map((r) => r.id);
  const mtIds = new Set(requirements.flatMap((r) => (r.measurementTypeId ? [r.measurementTypeId] : [])));
  const subIds = requirements.flatMap((r) => r.subQuestIds ?? []);

  const checks = reqIds.length
    ? tx
        .select()
        .from(t.milestoneChecks)
        .where(and(inArray(t.milestoneChecks.requirementId, reqIds), eq(t.milestoneChecks.periodKey, key)))
        .all()
    : [];
  const subs = subIds.length
    ? tx
        .select()
        .from(t.questCompletions)
        .where(and(inArray(t.questCompletions.questId, subIds), eq(t.questCompletions.periodKey, "once")))
        .all()
    : [];

  const evaluation = evaluateQuest({
    requirements,
    window: { start, end },
    activities: facts.activities().filter((a) => a.startAt >= start && a.startAt < end),
    assessments: facts
      .assessments()
      .filter((a) => mtIds.has(a.measurementTypeId))
      .map((a) => ({ id: a.id, measurementTypeId: a.measurementTypeId, at: a.at, score: a.score })),
    milestoneChecks: new Map(checks.map((c) => [c.requirementId, c.checkedAt])),
    subQuestCompletions: new Map(subs.map((s) => [s.questId, s.completedAt])),
  });
  return { locked: false, window: { start, end }, evaluation, requirements };
}

function questRewardExpected(tx: Tx, quest: QuestRow): Map<string, Expected> {
  const out = new Map<string, Expected>();
  if (quest.rewardXp <= 0) return out;
  out.set(CHARACTER, { amount: quest.rewardXp });
  const skills = tx
    .select()
    .from(t.questSkills)
    .where(eq(t.questSkills.questId, quest.id))
    .all()
    .map((s) => ({ skillId: s.skillId, weight: s.weight }));
  if (skills.length) for (const [id, amount] of splitByWeights(quest.rewardXp, skills)) out.set(skillKey(id), { amount });
  return out;
}

export const completionSourceId = (questId: string, key: string) => `${questId}|${key}`;

/** Returns true when the completion state of this quest period changed. */
function reconcileQuestPeriod(tx: Tx, facts: Facts, quest: QuestRow, key: string, log: ChangeLog, touched: Set<string>): boolean {
  const { evaluation } = evaluateQuestPeriod(tx, facts, quest, key);
  const tag = `${quest.id}|${key}`;

  // Contributions
  const want = new Map((evaluation?.contributions ?? []).map((c) => [`${c.activityId}|${c.requirementId}`, c]));
  const have = tx
    .select()
    .from(t.questContributions)
    .where(and(eq(t.questContributions.questId, quest.id), eq(t.questContributions.periodKey, key)))
    .all();
  for (const h of have) {
    const w = want.get(`${h.activityId}|${h.requirementId}`);
    if (!w) {
      tx.delete(t.questContributions)
        .where(
          and(
            eq(t.questContributions.activityId, h.activityId),
            eq(t.questContributions.requirementId, h.requirementId),
            eq(t.questContributions.periodKey, key),
          ),
        )
        .run();
      log.add(`contribution removed ${tag} ${h.activityId}`);
      touched.add(h.activityId);
    } else if (Math.abs(w.amount - h.amount) > 1e-9 || w.stageOrdinal !== h.stageOrdinal) {
      tx.update(t.questContributions)
        .set({ amount: w.amount, stageOrdinal: w.stageOrdinal })
        .where(
          and(
            eq(t.questContributions.activityId, h.activityId),
            eq(t.questContributions.requirementId, h.requirementId),
            eq(t.questContributions.periodKey, key),
          ),
        )
        .run();
      log.add(`contribution changed ${tag} ${h.activityId}`);
      touched.add(h.activityId);
    }
    want.delete(`${h.activityId}|${h.requirementId}`);
  }
  for (const w of want.values()) {
    tx.insert(t.questContributions)
      .values({ questId: quest.id, periodKey: key, requirementId: w.requirementId, activityId: w.activityId, amount: w.amount, stageOrdinal: w.stageOrdinal })
      .run();
    log.add(`contribution added ${tag} ${w.activityId}`);
    touched.add(w.activityId);
  }

  // Completion
  let changed = false;
  const existing = tx
    .select()
    .from(t.questCompletions)
    .where(and(eq(t.questCompletions.questId, quest.id), eq(t.questCompletions.periodKey, key)))
    .get();
  const doneAt = evaluation?.completedAt ?? null;
  const doneBy = evaluation?.completedByRef ?? null;
  if (doneAt === null && existing) {
    tx.delete(t.questCompletions)
      .where(and(eq(t.questCompletions.questId, quest.id), eq(t.questCompletions.periodKey, key)))
      .run();
    tx.insert(t.notices)
      .values({ kind: "quest_reopened", message: `"${quest.title}" reopened because the activities behind it changed.` })
      .run();
    log.add(`completion removed ${tag}`);
    if (existing.completedByRef) touched.add(existing.completedByRef);
    changed = true;
  } else if (doneAt !== null && !existing) {
    tx.insert(t.questCompletions).values({ questId: quest.id, periodKey: key, completedAt: doneAt, completedByRef: doneBy }).run();
    log.add(`completion added ${tag}`);
    if (doneBy) touched.add(doneBy);
    changed = true;
  } else if (doneAt !== null && existing && (existing.completedAt !== doneAt || existing.completedByRef !== doneBy)) {
    tx.update(t.questCompletions)
      .set({ completedAt: doneAt, completedByRef: doneBy })
      .where(and(eq(t.questCompletions.questId, quest.id), eq(t.questCompletions.periodKey, key)))
      .run();
    log.add(`completion moved ${tag}`);
    if (existing.completedByRef) touched.add(existing.completedByRef);
    if (doneBy) touched.add(doneBy);
    changed = true;
  }

  // Reward XP: the reward exists exactly while the completion exists.
  postDiff(tx, "quest_completion", completionSourceId(quest.id, key), doneAt !== null ? questRewardExpected(tx, quest) : new Map(), null, log);
  return changed;
}

/** Quests that depend on a quest's long-term completion (prerequisites and sub-quest requirements). */
function dependentsOf(tx: Tx, questId: string): string[] {
  const viaPrereq = tx
    .select()
    .from(t.questPrerequisites)
    .where(eq(t.questPrerequisites.requiresQuestId, questId))
    .all()
    .map((p) => p.questId);
  const viaSub = tx
    .select()
    .from(t.questRequirements)
    .where(eq(t.questRequirements.type, "subquests"))
    .all()
    .filter((r) => r.subQuestIds?.includes(questId))
    .map((r) => r.questId);
  return [...new Set([...viaPrereq, ...viaSub])];
}

/** Every period key that could hold progress for a quest. */
function allPeriodsFor(tx: Tx, facts: Facts, quest: QuestRow): string[] {
  if (quest.kind === "long_term") return ["once"];
  const keys = new Set<string>();
  for (const a of facts.activities()) keys.add(periodKeyOf(quest.kind, a.startAt, facts.ts));
  for (const a of facts.assessments()) keys.add(periodKeyOf(quest.kind, a.at, facts.ts));
  for (const c of tx.select().from(t.questContributions).where(eq(t.questContributions.questId, quest.id)).all()) keys.add(c.periodKey);
  for (const c of tx.select().from(t.questCompletions).where(eq(t.questCompletions.questId, quest.id)).all()) keys.add(c.periodKey);
  const reqIds = tx
    .select({ id: t.questRequirements.id })
    .from(t.questRequirements)
    .where(eq(t.questRequirements.questId, quest.id))
    .all()
    .map((r) => r.id);
  if (reqIds.length) {
    for (const m of tx.select().from(t.milestoneChecks).where(inArray(t.milestoneChecks.requirementId, reqIds)).all()) keys.add(m.periodKey);
  }
  return [...keys].sort();
}

/**
 * Reconciles the given (quest, period) pairs, then follows dependents until
 * nothing changes. Cycles are rejected when quests are saved, and a guard
 * stops runaway loops.
 */
function reconcileQuestWork(tx: Tx, facts: Facts, work: [QuestRow, string][], log: ChangeLog, touched: Set<string>): void {
  const queue = [...work];
  let guard = 0;
  while (queue.length) {
    if (++guard > 10_000) throw new Error("Quest reconcile did not converge");
    const [quest, key] = queue.shift()!;
    const changed = reconcileQuestPeriod(tx, facts, quest, key, log, touched);
    if (changed && key === "once") {
      for (const depId of dependentsOf(tx, quest.id)) {
        const dep = tx.select().from(t.quests).where(eq(t.quests.id, depId)).get();
        if (!dep) continue;
        for (const k of allPeriodsFor(tx, facts, dep)) queue.push([dep, k]);
      }
    }
  }
}

function allQuests(tx: Tx): QuestRow[] {
  return tx.select().from(t.quests).all();
}

/** Long-term quests in dependency order (prerequisites and sub-quests first), then recurring quests. */
function questsInDependencyOrder(tx: Tx): QuestRow[] {
  const quests = allQuests(tx);
  const byId = new Map(quests.map((q) => [q.id, q]));
  const deps = new Map<string, string[]>();
  for (const q of quests) deps.set(q.id, []);
  for (const p of tx.select().from(t.questPrerequisites).all()) deps.get(p.questId)?.push(p.requiresQuestId);
  for (const r of tx.select().from(t.questRequirements).where(eq(t.questRequirements.type, "subquests")).all()) {
    deps.get(r.questId)?.push(...(r.subQuestIds ?? []));
  }
  const out: QuestRow[] = [];
  const state = new Map<string, number>();
  const visit = (id: string) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) throw new Error(`Quest dependency cycle at ${id}`);
    state.set(id, 1);
    for (const d of deps.get(id) ?? []) if (byId.has(d)) visit(d);
    state.set(id, 2);
    out.push(byId.get(id)!);
  };
  for (const q of [...quests].sort((a, b) => (a.id < b.id ? -1 : 1))) visit(q.id);
  return [...out.filter((q) => q.kind === "long_term"), ...out.filter((q) => q.kind !== "long_term")];
}

// ----------------------------------------------------------------- medals ---

function tierXp(tx: Tx, tier: MedalTier): number {
  return currentFormula(tx).params.medalTierXp[tier];
}

function reconcileMedals(tx: Tx, facts: Facts, log: ChangeLog): void {
  const medals = tx.select().from(t.medals).all();

  // Linked awards are derived from quest completions and assessments.
  const expected = new Map<string, { id: string; medalId: string; occasionKey: string; occasion: string; awardedAt: number }>();
  for (const m of medals) {
    if (m.awardRule === "quest" && m.linkedQuestId) {
      const quest = tx.select().from(t.quests).where(eq(t.quests.id, m.linkedQuestId)).get();
      const completions = tx
        .select()
        .from(t.questCompletions)
        .where(eq(t.questCompletions.questId, m.linkedQuestId))
        .all()
        .sort((a, b) => a.completedAt - b.completedAt || (a.periodKey < b.periodKey ? -1 : 1));
      for (const c of m.repeatable ? completions : completions.slice(0, 1)) {
        const occasionKey = `quest:${c.questId}:${c.periodKey}`;
        expected.set(`${m.id}|${occasionKey}`, {
          id: `linked:${m.id}:${occasionKey}`,
          medalId: m.id,
          occasionKey,
          occasion: quest?.title ?? "Quest completed",
          awardedAt: c.completedAt,
        });
      }
    }
    if (m.awardRule === "assessment" && m.linkedMeasurementTypeId && m.linkedScoreThreshold !== null) {
      const hit = facts
        .assessments()
        .filter((a) => a.measurementTypeId === m.linkedMeasurementTypeId && a.score + 1e-9 >= m.linkedScoreThreshold!)
        .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))[0];
      if (hit) {
        const occasionKey = `assessment:${m.linkedMeasurementTypeId}`;
        expected.set(`${m.id}|${occasionKey}`, { id: `linked:${m.id}:${occasionKey}`, medalId: m.id, occasionKey, occasion: "Assessment result", awardedAt: hit.at });
      }
    }
  }
  const existingLinked = tx.select().from(t.medalAwards).where(eq(t.medalAwards.origin, "linked")).all();
  for (const e of existingLinked) {
    const k = `${e.medalId}|${e.occasionKey}`;
    const w = expected.get(k);
    if (!w) {
      tx.delete(t.medalAwards).where(eq(t.medalAwards.id, e.id)).run();
      const name = medals.find((m) => m.id === e.medalId)?.name ?? "A medal";
      tx.insert(t.notices).values({ kind: "medal_revoked", message: `${name} was removed because the record behind it changed.` }).run();
      log.add(`medal award removed ${e.id}`);
    } else if (w.awardedAt !== e.awardedAt) {
      tx.update(t.medalAwards).set({ awardedAt: w.awardedAt }).where(eq(t.medalAwards.id, e.id)).run();
      log.add(`medal award moved ${e.id}`);
    }
    expected.delete(k);
  }
  for (const w of expected.values()) {
    tx.insert(t.medalAwards)
      .values({ id: w.id, medalId: w.medalId, occasionKey: w.occasionKey, occasion: w.occasion, awardedAt: w.awardedAt, origin: "linked", source: "engine" })
      .run();
    log.add(`medal award added ${w.id}`);
  }

  // XP for every award, manual or linked. Removed awards fall back to zero.
  const awards = tx.select().from(t.medalAwards).all();
  const medalById = new Map(medals.map((m) => [m.id, m]));
  const medalSkills = new Map<string, WeightedSkill[]>();
  for (const s of tx.select().from(t.medalSkills).all()) {
    medalSkills.set(s.medalId, [...(medalSkills.get(s.medalId) ?? []), { skillId: s.skillId, weight: s.weight }]);
  }
  const ids = new Set([...awards.map((a) => a.id), ...ledgerSourceIds(tx, "medal_award")]);
  const awardById = new Map(awards.map((a) => [a.id, a]));
  for (const id of [...ids].sort()) {
    const a = awardById.get(id);
    const out = new Map<string, Expected>();
    const medal = a ? medalById.get(a.medalId) : undefined;
    if (a && medal) {
      const amount = a.xpOverride ?? medal.xpReward ?? tierXp(tx, a.tierOverride ?? medal.tier);
      out.set(CHARACTER, { amount });
      const skills = a.skillsOverride ?? medalSkills.get(medal.id) ?? [];
      if (skills.length) for (const [sid, amt] of splitByWeights(amount, skills)) out.set(skillKey(sid), { amount: amt });
    }
    postDiff(tx, "medal_award", id, out, null, log);
  }
}

// ----------------------------------------------------------- achievements ---

interface XpEvent {
  at: number;
  amount: number;
  ref: string;
  targetType: "character" | "skill";
  targetId: string;
}

function xpTimeline(tx: Tx, facts: Facts): XpEvent[] {
  const rows = tx.select().from(t.xpEntries).all();
  const net = new Map<string, XpEvent>();
  const completions = new Map(tx.select().from(t.questCompletions).all().map((c) => [completionSourceId(c.questId, c.periodKey), c.completedAt]));
  const awards = new Map(tx.select().from(t.medalAwards).all().map((a) => [a.id, a.awardedAt]));
  const acts = facts.activityRows();
  for (const r of rows) {
    const k = `${r.sourceType}|${r.sourceId}|${r.targetType}|${r.targetId}`;
    let at: number | undefined;
    if (r.sourceType === "activity") {
      const a = acts.get(r.sourceId);
      at = a ? a.startAt + a.durationMin * 60_000 : undefined;
    } else if (r.sourceType === "quest_completion") at = completions.get(r.sourceId);
    else at = awards.get(r.sourceId);
    const cur = net.get(k) ?? { at: at ?? 0, amount: 0, ref: `${r.sourceType}:${r.sourceId}`, targetType: r.targetType, targetId: r.targetId };
    cur.amount += r.amount;
    net.set(k, cur);
  }
  return [...net.values()].filter((e) => e.amount !== 0);
}

/** Computes when (if ever) each achievement's condition was first met. Deterministic. */
export function computeUnlocks(tx: Tx, facts: Facts): Map<string, { at: number; ref: string }> {
  const out = new Map<string, { at: number; ref: string }>();
  const defs = tx.select().from(t.achievements).all();
  if (!defs.length) return out;
  const acts = facts.activities();
  const end = (a: ActivityFact) => a.startAt + a.durationMin * 60_000;
  let timeline: XpEvent[] | undefined;
  const completions = tx.select().from(t.questCompletions).all();
  const questKinds = new Map(allQuests(tx).map((q) => [q.id, q.kind]));
  const awards = tx.select().from(t.medalAwards).all();
  const medals = new Map(tx.select().from(t.medals).all().map((m) => [m.id, m]));

  for (const d of defs) {
    const p = d.params as Record<string, unknown>;
    const num = (k: string) => Number(p[k] ?? 0);
    const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
    let hit: { at: number; ref: string } | null = null;

    if (d.conditionType === "activity_count") {
      const skill = str("skillId");
      const type = str("activityTypeId");
      const set = skill ? facts.tree.withDescendants(skill) : null;
      const list = acts.filter((a) => (!type || a.activityTypeId === type) && (!set || a.skills.some((s) => set.has(s.skillId))));
      hit = firstCrossing(list.map((a) => ({ at: end(a), amount: 1, ref: a.id })), num("count"));
    } else if (d.conditionType === "total_minutes") {
      const skill = str("skillId");
      const attr = str("attributeId");
      const set = skill ? facts.tree.withDescendants(skill) : attr ? facts.tree.ofAttribute(attr) : null;
      const events = acts.map((a) => ({
        at: end(a),
        ref: a.id,
        amount: set ? (a.durationMin * a.skills.reduce((s, k) => s + (set.has(k.skillId) ? k.weight : 0), 0)) / 100 : a.durationMin,
      }));
      hit = firstCrossing(events, num("minutes"));
    } else if (d.conditionType === "quest_completions") {
      const kind = str("kind");
      const list = completions.filter((c) => !kind || questKinds.get(c.questId) === kind);
      hit = firstCrossing(list.map((c) => ({ at: c.completedAt, amount: 1, ref: `quest:${c.questId}|${c.periodKey}` })), num("count"));
    } else if (d.conditionType === "streak") {
      const minutes = new Map<string, number>();
      for (const a of acts) minutes.set(a.dayKey, (minutes.get(a.dayKey) ?? 0) + a.durationMin);
      const active = new Set([...minutes].filter(([, m]) => m >= 10).map(([k]) => k));
      const last = [...active].sort().at(-1);
      if (last) {
        const day = streaks(active, last, facts.profile.restDaysPerWeek).reachedOn.get(num("days"));
        if (day) {
          const lastOnDay = acts.filter((a) => a.dayKey === day).at(-1)!;
          hit = { at: end(lastOnDay), ref: lastOnDay.id };
        }
      }
    } else if (d.conditionType === "level") {
      timeline ??= xpTimeline(tx, facts);
      const skill = str("skillId");
      const formula = currentFormula(tx).params;
      const curve = skill ? formula.skillCurve : formula.characterCurve;
      const set = skill ? facts.tree.withDescendants(skill) : null;
      const events = timeline.filter((e) => (set ? e.targetType === "skill" && set.has(e.targetId) : e.targetType === "character"));
      const sorted = [...events].sort((a, b) => a.at - b.at || (a.ref < b.ref ? -1 : 1));
      let total = 0;
      for (const e of sorted) {
        total += e.amount;
        if (levelFromXp(total, curve).level >= num("level")) {
          hit = { at: e.at, ref: e.ref };
          break;
        }
      }
    } else if (d.conditionType === "assessment_score") {
      const mt = str("measurementTypeId");
      const first = facts
        .assessments()
        .filter((a) => a.measurementTypeId === mt && a.score + 1e-9 >= num("score"))
        .sort((a, b) => a.at - b.at)[0];
      if (first) hit = { at: first.at, ref: first.id };
    } else if (d.conditionType === "medal_count") {
      const tier = str("tier");
      const list = awards.filter((a) => !tier || (a.tierOverride ?? medals.get(a.medalId)?.tier) === tier);
      hit = firstCrossing(list.map((a) => ({ at: a.awardedAt, amount: 1, ref: a.id })), num("count"));
    }
    if (hit) out.set(d.id, hit);
  }
  return out;
}

function reconcileAchievements(tx: Tx, facts: Facts, log: ChangeLog): void {
  const want = computeUnlocks(tx, facts);
  const have = tx.select().from(t.achievementUnlocks).all();
  const names = new Map(tx.select().from(t.achievements).all().map((a) => [a.id, a.name]));
  for (const h of have) {
    const w = want.get(h.achievementId);
    if (!w) {
      tx.delete(t.achievementUnlocks).where(eq(t.achievementUnlocks.achievementId, h.achievementId)).run();
      tx.insert(t.notices)
        .values({ kind: "achievement_revoked", message: `"${names.get(h.achievementId) ?? "An achievement"}" was removed because the record behind it changed.` })
        .run();
      log.add(`achievement revoked ${h.achievementId}`);
    } else if (w.at !== h.unlockedAt || w.ref !== h.triggerRef) {
      tx.update(t.achievementUnlocks).set({ unlockedAt: w.at, triggerRef: w.ref }).where(eq(t.achievementUnlocks.achievementId, h.achievementId)).run();
      log.add(`achievement moved ${h.achievementId}`);
    }
    want.delete(h.achievementId);
  }
  for (const [id, w] of want) {
    tx.insert(t.achievementUnlocks).values({ achievementId: id, unlockedAt: w.at, triggerRef: w.ref }).run();
    log.add(`achievement unlocked ${id}`);
  }
}

// ---------------------------------------------------------------- journal ---

const UNIT: Record<string, string> = { duration: "min", sessions: "session", distinct_days: "day" };

export function autoJournalBody(tx: Tx, facts: Facts, a: ActivityRow): string {
  const parts: string[] = [`${a.name}. ${a.durationMin} min, ${DIFFICULTY_LABELS[a.difficulty as Difficulty] ?? a.difficulty}.`];
  const xp = tx.select().from(t.xpEntries).where(and(eq(t.xpEntries.sourceType, "activity"), eq(t.xpEntries.sourceId, a.id))).all();
  const net = new Map<string, number>();
  for (const e of xp) {
    const k = e.targetType === "character" ? CHARACTER : e.targetId;
    net.set(k, (net.get(k) ?? 0) + e.amount);
  }
  const total = net.get(CHARACTER) ?? 0;
  const skillParts = [...net]
    .filter(([k, v]) => k !== CHARACTER && v !== 0)
    .map(([k, v]) => `${facts.tree.skills.get(k)?.name ?? k} ${v}`)
    .sort();
  parts.push(`+${total} XP${skillParts.length ? ` (${skillParts.join(", ")})` : ""}.`);

  const contribs = tx.select().from(t.questContributions).where(eq(t.questContributions.activityId, a.id)).all();
  if (contribs.length) {
    const reqs = new Map(
      tx
        .select()
        .from(t.questRequirements)
        .where(inArray(t.questRequirements.id, [...new Set(contribs.map((c) => c.requirementId))]))
        .all()
        .map((r) => [r.id, r]),
    );
    const titles = new Map(allQuests(tx).map((q) => [q.id, q.title]));
    const lines = contribs
      .map((c) => {
        const unit = UNIT[reqs.get(c.requirementId)?.type ?? ""] ?? "";
        const amount = Math.round(c.amount * 10) / 10;
        return `${titles.get(c.questId) ?? c.questId} +${amount}${unit ? ` ${unit}` : ""}`;
      })
      .sort();
    parts.push(`Progress: ${lines.join(", ")}.`);
  }
  const completed = tx.select().from(t.questCompletions).where(eq(t.questCompletions.completedByRef, a.id)).all();
  if (completed.length) {
    const titles = new Map(allQuests(tx).map((q) => [q.id, q.title]));
    parts.push(`Completed ${completed.map((c) => titles.get(c.questId) ?? c.questId).sort().join(", ")}.`);
  }
  if (a.notes) parts.push(a.notes);
  return parts.join(" ");
}

function reconcileJournal(tx: Tx, facts: Facts, activityId: string, log: ChangeLog, revisionChanged: boolean): void {
  const a = tx.select().from(t.activities).where(eq(t.activities.id, activityId)).get();
  const id = `auto:${activityId}`;
  const existing = tx.select().from(t.journalEntries).where(eq(t.journalEntries.id, id)).get();
  if (!a || a.deletedAt !== null) {
    if (existing && !existing.userEdited) {
      tx.delete(t.journalEntries).where(eq(t.journalEntries.id, id)).run();
      log.add(`journal removed ${id}`);
    } else if (existing && existing.userEdited && !existing.activityDeleted) {
      tx.update(t.journalEntries).set({ activityDeleted: true }).where(eq(t.journalEntries.id, id)).run();
    }
    return;
  }
  const day = dayKey(a.startAt, facts.ts);
  if (existing?.userEdited) {
    const patch: Partial<typeof t.journalEntries.$inferInsert> = {};
    if (existing.activityDeleted) patch.activityDeleted = false;
    if (revisionChanged && !existing.activityChangedSinceEdit) patch.activityChangedSinceEdit = true;
    if (Object.keys(patch).length) tx.update(t.journalEntries).set(patch).where(eq(t.journalEntries.id, id)).run();
    return;
  }
  const body = autoJournalBody(tx, facts, a);
  if (!existing) {
    tx.insert(t.journalEntries).values({ id, type: "auto", day, activityId, title: a.name, body }).run();
    log.add(`journal added ${id}`);
  } else if (existing.body !== body || existing.day !== day || existing.title !== a.name) {
    tx.update(t.journalEntries).set({ body, day, title: a.name, updatedAt: Date.now() }).where(eq(t.journalEntries.id, id)).run();
    log.add(`journal changed ${id}`);
  }
}

// ------------------------------------------------------------- entry points ---

/** Reconcile after one activity was created, edited, deleted or restored. */
export function reconcileAfterActivity(
  tx: Tx,
  activityId: string,
  startTimes: number[],
  log = new ChangeLog(),
  opts: { revisionChanged?: boolean } = {},
): ChangeLog {
  const facts = new Facts(tx);
  reconcileActivityXp(tx, activityId, log);
  const touched = new Set<string>([activityId]);
  const work: [QuestRow, string][] = [];
  for (const q of questsInDependencyOrder(tx)) {
    const keys = new Set(startTimes.map((s) => periodKeyOf(q.kind, s, facts.ts)));
    for (const k of keys) work.push([q, k]);
  }
  reconcileQuestWork(tx, facts, work, log, touched);
  reconcileMedals(tx, facts, log);
  reconcileAchievements(tx, facts, log);
  for (const id of touched) reconcileJournal(tx, facts, id, log, id === activityId && !!opts.revisionChanged);
  return log;
}

/** Reconcile after an assessment changed: quests and medals that use its measurement, then achievements. */
export function reconcileAfterAssessment(tx: Tx, measurementTypeId: string, times: number[], log = new ChangeLog()): ChangeLog {
  const facts = new Facts(tx);
  const questIds = new Set(
    tx
      .select()
      .from(t.questRequirements)
      .where(and(eq(t.questRequirements.type, "assessment"), eq(t.questRequirements.measurementTypeId, measurementTypeId)))
      .all()
      .map((r) => r.questId),
  );
  const touched = new Set<string>();
  const work: [QuestRow, string][] = [];
  for (const q of questsInDependencyOrder(tx)) {
    if (!questIds.has(q.id)) continue;
    for (const k of new Set(times.map((s) => periodKeyOf(q.kind, s, facts.ts)))) work.push([q, k]);
  }
  reconcileQuestWork(tx, facts, work, log, touched);
  reconcileMedals(tx, facts, log);
  reconcileAchievements(tx, facts, log);
  for (const id of touched) reconcileJournal(tx, facts, id, log, false);
  return log;
}

/** Reconcile one quest across all its periods (after its definition, a milestone, or its status changed). */
export function reconcileQuest(tx: Tx, questId: string, log = new ChangeLog()): ChangeLog {
  const facts = new Facts(tx);
  const q = tx.select().from(t.quests).where(eq(t.quests.id, questId)).get();
  const touched = new Set<string>();
  if (q) reconcileQuestWork(tx, facts, allPeriodsFor(tx, facts, q).map((k) => [q, k] as [QuestRow, string]), log, touched);
  // Contributions and completions for a removed quest are cleaned up by reconcileAll.
  reconcileMedals(tx, facts, log);
  reconcileAchievements(tx, facts, log);
  for (const id of touched) reconcileJournal(tx, facts, id, log, false);
  return log;
}

/** Reconcile medals and achievements only (after a manual medal award changed). */
export function reconcileHonors(tx: Tx, log = new ChangeLog()): ChangeLog {
  const facts = new Facts(tx);
  reconcileMedals(tx, facts, log);
  reconcileAchievements(tx, facts, log);
  return log;
}

/** Recompute every derived record from sources. */
export function reconcileAll(tx: Tx, log = new ChangeLog()): ChangeLog {
  const facts = new Facts(tx);
  const activityIds = new Set([...facts.activityRows().keys(), ...ledgerSourceIds(tx, "activity")]);
  for (const id of [...activityIds].sort()) reconcileActivityXp(tx, id, log);

  const quests = questsInDependencyOrder(tx);
  const known = new Set(quests.map((q) => q.id));
  const touched = new Set<string>();
  for (const q of quests) reconcileQuestWork(tx, facts, allPeriodsFor(tx, facts, q).map((k) => [q, k] as [QuestRow, string]), log, touched);

  // Derived rows for quests that no longer exist.
  for (const c of tx.select().from(t.questContributions).all()) {
    if (!known.has(c.questId)) {
      tx.delete(t.questContributions).where(eq(t.questContributions.questId, c.questId)).run();
      log.add(`contribution removed (quest gone) ${c.questId}`);
      touched.add(c.activityId);
    }
  }
  for (const c of tx.select().from(t.questCompletions).all()) {
    if (!known.has(c.questId)) {
      tx.delete(t.questCompletions).where(eq(t.questCompletions.questId, c.questId)).run();
      log.add(`completion removed (quest gone) ${c.questId}`);
    }
  }
  for (const id of ledgerSourceIds(tx, "quest_completion")) {
    const [questId] = id.split("|");
    if (!known.has(questId!)) postDiff(tx, "quest_completion", id, new Map(), null, log);
  }

  reconcileMedals(tx, facts, log);
  reconcileAchievements(tx, facts, log);

  const journalIds = new Set([
    ...facts.activityRows().keys(),
    ...tx
      .select({ id: t.journalEntries.activityId })
      .from(t.journalEntries)
      .where(eq(t.journalEntries.type, "auto"))
      .all()
      .flatMap((r) => (r.id ? [r.id] : [])),
  ]);
  for (const id of [...journalIds].sort()) reconcileJournal(tx, facts, id, log, false);
  return log;
}

const ROLLBACK = Symbol("dry-run rollback");

/** Runs fn in a transaction that is always rolled back, returning what it would change. */
export function dryRun(db: DB, fn: (tx: Tx, log: ChangeLog) => void): string[] {
  const log = new ChangeLog();
  try {
    db.transaction((tx) => {
      fn(tx, log);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return log.items;
}

/** The rebuild check: an empty list means every derived record matches its sources. */
export function verify(db: DB): string[] {
  return dryRun(db, (tx, log) => reconcileAll(tx, log));
}
