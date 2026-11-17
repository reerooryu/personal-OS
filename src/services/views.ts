/** Read models for individual screens. No writes. */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { normalize } from "@/domain/proficiency";
import { addDays, dayKey, localParts, mondayOfWeek, periodRange, weekKey } from "@/domain/time";
import { gradeFor } from "@/domain/proficiency";
import { computeXp } from "@/domain/xp";
import { currentFormula, getFormula, getProfile, loadSkillTree, timeSettings } from "./context";
import { evaluateQuestPeriod, Facts } from "./engine";
import { getTimer } from "./activities";
import { medalCase, questBoard, skillSummaries, xpTotals } from "./queries";
import { calendarInbox } from "./calendar";

export type TemplateRow = typeof t.activityTemplates.$inferSelect;

/** Tiles: pinned first, then most recently used. */
export function tiles(db: DB): TemplateRow[] {
  return db
    .select()
    .from(t.activityTemplates)
    .all()
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.sortOrder - b.sortOrder);
}

/**
 * "Suggested now": the templates most often logged within an hour of now, on
 * the same kind of day (weekday or weekend), over the last four weeks.
 */
export function suggestedNow(db: DB, now = Date.now(), limit = 3): TemplateRow[] {
  const ts = timeSettings(getProfile(db));
  const p = localParts(now, ts.timezone);
  const weekend = (ms: number) => {
    const d = new Date(dayKey(ms, ts));
    return d.getUTCDay() === 0 || d.getUTCDay() === 6;
  };
  const isWeekend = weekend(now);
  const since = now - 28 * 86_400_000;
  const score = new Map<string, number>();
  for (const a of db.select().from(t.activities).where(isNull(t.activities.deletedAt)).all()) {
    if (!a.templateId || a.startAt < since || weekend(a.startAt) !== isWeekend) continue;
    const h = localParts(a.startAt, ts.timezone).hour;
    const dist = Math.min(Math.abs(h - p.hour), 24 - Math.abs(h - p.hour));
    if (dist <= 1) score.set(a.templateId, (score.get(a.templateId) ?? 0) + (dist === 0 ? 2 : 1));
  }
  const all = new Map(tiles(db).map((x) => [x.id, x]));
  return [...score]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .flatMap(([id]) => (all.get(id) ? [all.get(id)!] : []))
    .slice(0, limit);
}

export function timerView(db: DB) {
  const timer = getTimer(db);
  if (!timer) return null;
  const tpl = db.select().from(t.activityTemplates).where(eq(t.activityTemplates.id, timer.templateId)).get();
  return { templateId: timer.templateId, name: tpl?.name ?? "Session", startedAt: timer.startedAt };
}

/** Today's daily quests: the ring and the objectives list. */
export function today(db: DB, now = Date.now()) {
  const ts = timeSettings(getProfile(db));
  const board = questBoard(db, now).filter((q) => q.kind === "daily" && q.state !== "proposed");
  const range = periodRange("daily", dayKey(now, ts), ts);
  const acts = db
    .select()
    .from(t.activities)
    .where(isNull(t.activities.deletedAt))
    .all()
    .filter((a) => a.startAt >= range.start && a.startAt < range.end);
  return {
    day: dayKey(now, ts),
    objectives: board,
    done: board.filter((q) => q.state === "completed").length,
    total: board.length,
    minutes: acts.reduce((s, a) => s + a.durationMin, 0),
    sessions: acts.length,
  };
}

/** Last week's recap, shown on Mondays. */
export function weekInReview(db: DB, now = Date.now()) {
  const ts = timeSettings(getProfile(db));
  const thisWeek = weekKey(now, ts);
  const lastMonday = addDays(mondayOfWeek(thisWeek), -7);
  const key = weekKey(periodRange("daily", lastMonday, ts).start, ts);
  const range = periodRange("weekly", key, ts);
  const acts = db
    .select()
    .from(t.activities)
    .where(isNull(t.activities.deletedAt))
    .all()
    .filter((a) => a.startAt >= range.start && a.startAt < range.end);
  if (acts.length === 0) return null;
  const xpRows = db
    .select()
    .from(t.xpEntries)
    .where(and(eq(t.xpEntries.sourceType, "activity"), eq(t.xpEntries.targetType, "character"), inArray(t.xpEntries.sourceId, acts.map((a) => a.id))))
    .all();
  const byDay = new Map<string, number>();
  for (const a of acts) byDay.set(dayKey(a.startAt, ts), (byDay.get(dayKey(a.startAt, ts)) ?? 0) + a.durationMin);
  const best = [...byDay].sort((a, b) => b[1] - a[1])[0];
  const completions = db.select().from(t.questCompletions).all().filter((c) => c.completedAt >= range.start && c.completedAt < range.end);
  const medals = medalCase(db).filter((m) => m.awardedAt >= range.start && m.awardedAt < range.end);
  return {
    week: key,
    minutes: acts.reduce((s, a) => s + a.durationMin, 0),
    sessions: acts.length,
    xp: xpRows.reduce((s, e) => s + e.amount, 0),
    bestDay: best ? { day: best[0], minutes: best[1] } : null,
    quests: completions.length,
    medals: medals.length,
  };
}

export interface ActivityListItem {
  id: string;
  name: string;
  startAt: number;
  day: string;
  durationMin: number;
  difficulty: string;
  activityTypeId: string;
  xp: number;
  skills: string[];
  isSample: boolean;
  source: string;
}

export function activityHistory(db: DB, opts: { limit?: number; skillId?: string } = {}): ActivityListItem[] {
  const ts = timeSettings(getProfile(db));
  const tree = loadSkillTree(db);
  const filterSet = opts.skillId ? tree.withDescendants(opts.skillId) : null;
  const skillsBy = new Map<string, string[]>();
  for (const s of db.select().from(t.activitySkills).all()) skillsBy.set(s.activityId, [...(skillsBy.get(s.activityId) ?? []), s.skillId]);
  const xpBy = new Map<string, number>();
  for (const e of db.select().from(t.xpEntries).where(and(eq(t.xpEntries.sourceType, "activity"), eq(t.xpEntries.targetType, "character"))).all()) {
    xpBy.set(e.sourceId, (xpBy.get(e.sourceId) ?? 0) + e.amount);
  }
  return db
    .select()
    .from(t.activities)
    .where(isNull(t.activities.deletedAt))
    .orderBy(desc(t.activities.startAt))
    .all()
    .filter((a) => !filterSet || (skillsBy.get(a.id) ?? []).some((s) => filterSet.has(s)))
    .slice(0, opts.limit ?? 200)
    .map((a) => ({
      id: a.id,
      name: a.name,
      startAt: a.startAt,
      day: dayKey(a.startAt, ts),
      durationMin: a.durationMin,
      difficulty: a.difficulty,
      activityTypeId: a.activityTypeId,
      xp: xpBy.get(a.id) ?? 0,
      skills: (skillsBy.get(a.id) ?? []).map((s) => tree.skills.get(s)?.name ?? s),
      isSample: a.isSample,
      source: a.source,
    }));
}

export function activityDetail(db: DB, id: string) {
  const a = db.select().from(t.activities).where(eq(t.activities.id, id)).get();
  if (!a) return null;
  const tree = loadSkillTree(db);
  const quests = new Map(db.select().from(t.quests).all().map((q) => [q.id, q.title]));
  return {
    activity: a,
    skills: db
      .select()
      .from(t.activitySkills)
      .where(eq(t.activitySkills.activityId, id))
      .all()
      .map((s) => ({ ...s, name: tree.skills.get(s.skillId)?.name ?? s.skillId })),
    ledger: db
      .select()
      .from(t.xpEntries)
      .where(and(eq(t.xpEntries.sourceType, "activity"), eq(t.xpEntries.sourceId, id)))
      .all()
      .map((e) => ({ ...e, targetName: e.targetType === "character" ? "Character" : (tree.skills.get(e.targetId)?.name ?? e.targetId) })),
    revisions: db
      .select()
      .from(t.revisions)
      .where(and(eq(t.revisions.entityType, "activity"), eq(t.revisions.entityId, id)))
      .orderBy(desc(t.revisions.revision))
      .all(),
    contributions: db
      .select()
      .from(t.questContributions)
      .where(eq(t.questContributions.activityId, id))
      .all()
      .map((c) => ({ ...c, questTitle: quests.get(c.questId) ?? c.questId })),
    completed: db
      .select()
      .from(t.questCompletions)
      .where(eq(t.questCompletions.completedByRef, id))
      .all()
      .map((c) => quests.get(c.questId) ?? c.questId),
    journal: db.select().from(t.journalEntries).where(eq(t.journalEntries.activityId, id)).get() ?? null,
    breakdown: computeXp({ durationMin: a.durationMin, difficulty: a.difficulty, activityTypeId: a.activityTypeId }, getFormula(db, a.formulaVersionId)),
    typeName: db.select().from(t.activityTypes).where(eq(t.activityTypes.id, a.activityTypeId)).get()?.name ?? a.activityTypeId,
  };
}

export function skillDetail(db: DB, id: string) {
  const summary = skillSummaries(db).find((s) => s.id === id);
  if (!summary) return null;
  const tree = loadSkillTree(db);
  const profile = getProfile(db);
  const family = tree.withDescendants(id);
  const types = db.select().from(t.measurementTypes).where(eq(t.measurementTypes.skillId, id)).all();
  const typeById = new Map(types.map((m) => [m.id, m]));
  const assessments = db
    .select()
    .from(t.assessments)
    .where(and(eq(t.assessments.skillId, id), isNull(t.assessments.deletedAt)))
    .orderBy(desc(t.assessments.assessedAt))
    .all()
    .map((a) => {
      const mt = typeById.get(a.measurementTypeId);
      const score = mt ? normalize(mt, a.rawValue, a.rawLabel) : null;
      return {
        ...a,
        measurement: mt?.name ?? a.measurementTypeId,
        unit: mt?.unit ?? null,
        score: score === null ? null : Math.round(score),
        grade: gradeFor(score === null ? null : Math.round(score), profile.gradeBands),
      };
    });
  const ledger = db
    .select()
    .from(t.xpEntries)
    .where(and(eq(t.xpEntries.targetType, "skill"), inArray(t.xpEntries.targetId, [...family])))
    .orderBy(desc(t.xpEntries.id))
    .limit(40)
    .all();
  const children = skillSummaries(db).filter((s) => s.parentId === id);
  const questIds = new Set(db.select().from(t.questSkills).where(eq(t.questSkills.skillId, id)).all().map((q) => q.questId));
  return {
    summary,
    skill: tree.skills.get(id)!,
    types,
    assessments,
    ledger,
    children,
    quests: questBoard(db).filter((q) => questIds.has(q.id)),
    recent: activityHistory(db, { skillId: id, limit: 15 }),
    attributes: db.select().from(t.attributes).all(),
    possibleParents: [...tree.skills.values()].filter((s) => s.kind === "skill" && s.id !== id && !tree.withDescendants(id).has(s.id)),
  };
}

export function questDetail(db: DB, id: string, now = Date.now()) {
  const q = db.select().from(t.quests).where(eq(t.quests.id, id)).get();
  if (!q) return null;
  const facts = new Facts(db);
  const card = questBoard(db, now).find((c) => c.id === id) ?? null;
  const key = card?.periodKey ?? (q.kind === "long_term" ? "once" : "");
  const pe = evaluateQuestPeriod(db, facts, q, key);
  const acts = new Map(db.select().from(t.activities).all().map((a) => [a.id, a]));
  const contributions = db
    .select()
    .from(t.questContributions)
    .where(and(eq(t.questContributions.questId, id), eq(t.questContributions.periodKey, key)))
    .all()
    .map((c) => ({ ...c, activity: acts.get(c.activityId) ?? null }));
  const checks = new Set(
    db
      .select()
      .from(t.milestoneChecks)
      .where(eq(t.milestoneChecks.periodKey, key))
      .all()
      .map((m) => m.requirementId),
  );
  const history = db
    .select()
    .from(t.questCompletions)
    .where(eq(t.questCompletions.questId, id))
    .orderBy(desc(t.questCompletions.completedAt))
    .limit(20)
    .all();
  const prereqs = db
    .select()
    .from(t.questPrerequisites)
    .where(eq(t.questPrerequisites.questId, id))
    .all()
    .map((p) => db.select().from(t.quests).where(eq(t.quests.id, p.requiresQuestId)).get()?.title ?? p.requiresQuestId);
  const children = db.select().from(t.quests).where(eq(t.quests.parentQuestId, id)).all();
  const parent = q.parentQuestId ? db.select().from(t.quests).where(eq(t.quests.id, q.parentQuestId)).get() : null;
  const medal = db.select().from(t.medals).where(eq(t.medals.linkedQuestId, id)).get() ?? null;
  return { quest: q, card, key, evaluation: pe.evaluation, requirements: pe.requirements, locked: pe.locked, contributions, checks, history, prereqs, children, parent, medal };
}

export function honors(db: DB) {
  const medals = db.select().from(t.medals).all();
  return { awards: medalCase(db), medals, tierXp: currentFormula(db).params.medalTierXp };
}

export function formOptions(db: DB) {
  const tree = loadSkillTree(db);
  return {
    skills: [...tree.skills.values()]
      .filter((s) => s.kind === "skill" && !s.archived)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({ id: s.id, name: s.name, attributeId: s.attributeId, parentId: s.parentId })),
    attributes: db.select().from(t.attributes).all().sort((a, b) => a.sortOrder - b.sortOrder),
    activityTypes: db.select().from(t.activityTypes).all().sort((a, b) => a.sortOrder - b.sortOrder),
    measurementTypes: db.select().from(t.measurementTypes).all(),
    quests: db.select().from(t.quests).all(),
  };
}

export function sampleDataCount(db: DB): number {
  return db.select().from(t.activities).where(and(eq(t.activities.isSample, true), isNull(t.activities.deletedAt))).all().length;
}

export function totals(db: DB) {
  return xpTotals(db);
}

const DEFAULT_TYPE_BY_ATTRIBUTE: Record<string, string> = { academics: "study", athletics: "training", engineering: "project" };

/** Choices for the dropdown logger: templates first, then any skill on its own. */
export function quickLogOptions(db: DB) {
  const skills = formOptions(db).skills;
  return {
    templates: tiles(db).map((x) => ({
      id: x.id,
      name: x.name,
      durationMin: x.durationMin,
      difficulty: x.difficulty,
      activityTypeId: x.activityTypeId,
      skills: x.skills,
    })),
    skills: skills.map((k) => ({ id: k.id, name: k.name, activityTypeId: DEFAULT_TYPE_BY_ATTRIBUTE[k.attributeId] ?? "practice" })),
  };
}
export type QuickLogOptions = ReturnType<typeof quickLogOptions>;

/** Skills that can be logged, with their attribute name, for skill dropdowns. */
export function skillChoices(db: DB) {
  const o = formOptions(db);
  const attr = new Map(o.attributes.map((a) => [a.id, a.name]));
  return o.skills.map((s) => ({ id: s.id, name: s.name, attribute: attr.get(s.attributeId) ?? "" }));
}

/** "Did you go?" rows, ready for the client. */
export function calendarInboxItems(db: DB, now = Date.now()) {
  const names = new Map(db.select().from(t.skills).all().map((s) => [s.id, s.name]));
  return calendarInbox(db, now).map((o) => ({
    key: o.key,
    title: o.title,
    location: o.location,
    startAt: o.startAt,
    endAt: o.endAt,
    kind: o.kind,
    needsSkill: o.needsSkill,
    skillName: o.skillId ? (names.get(o.skillId) ?? null) : null,
    small: o.xp === "small",
  }));
}

export interface RevisionStatus {
  questId: string;
  state: string;
  reason: string | null;
  minutes: { done: number; target: number };
  days: { done: number; target: number } | null;
}

/** Attaches each test's revision-quest progress, for the test cards. */
export function withRevision<T extends { revisionQuestId: string | null }>(db: DB, tests: T[], now = Date.now()): (T & { revision: RevisionStatus | null })[] {
  if (!tests.some((x) => x.revisionQuestId)) return tests.map((x) => ({ ...x, revision: null }));
  const cards = new Map(questBoard(db, now).map((c) => [c.id, c]));
  const reasons = new Map(db.select({ id: t.quests.id, d: t.quests.description }).from(t.quests).all().map((q) => [q.id, q.d]));
  return tests.map((x) => {
    const c = x.revisionQuestId ? cards.get(x.revisionQuestId) : undefined;
    if (!c) return { ...x, revision: null };
    const dur = c.requirements.find((r) => r.type === "duration");
    const days = c.requirements.find((r) => r.type === "distinct_days");
    return {
      ...x,
      revision: {
        questId: c.id,
        state: c.state,
        reason: reasons.get(c.id) ?? null,
        minutes: { done: Math.round(Math.min(dur?.progress ?? 0, dur?.target ?? 0)), target: dur?.target ?? 0 },
        days: days ? { done: Math.min(days.progress, days.target), target: days.target } : null,
      },
    };
  });
}
