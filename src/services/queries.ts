/** Read models for the screens. No writes. */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { gradeFor, gradeProgress, proficiency, STALE_AFTER_MS } from "@/domain/proficiency";
import { addDays, dayKey, periodKey as periodKeyOf } from "@/domain/time";
import { consistencyScore, disciplineScore, streaks, TRAIT_WINDOW_DAYS } from "@/domain/traits";
import type { MedalTier } from "@/domain/types";
import { levelFromXp, type LevelInfo } from "@/domain/xp";
import { currentFormula, getProfile, loadSkillTree, timeSettings } from "./context";
import { evaluateQuestPeriod, Facts } from "./engine";

export function isSeeded(db: DB): boolean {
  return Number(db.select({ n: sql<number>`count(*)` }).from(t.profile).get()?.n ?? 0) > 0;
}

export function xpTotals(db: DB): { character: number; bySkill: Map<string, number> } {
  const bySkill = new Map<string, number>();
  let character = 0;
  for (const e of db.select().from(t.xpEntries).all()) {
    if (e.targetType === "character") character += e.amount;
    else bySkill.set(e.targetId, (bySkill.get(e.targetId) ?? 0) + e.amount);
  }
  return { character, bySkill };
}

export interface SkillSummary {
  id: string;
  name: string;
  attributeId: string;
  parentId: string | null;
  kind: "skill" | "trait";
  archived: boolean;
  /** XP posted to this skill directly. */
  ownXp: number;
  /** Own XP plus all descendants. Levels use this. */
  xp: number;
  level: LevelInfo;
  minutes: number;
  sessions: number;
  proficiency: number | null;
  grade: string | null;
  nextGrade: string | null;
  gradeProgress: number;
  assessedAt: number | null;
  stale: boolean;
}

export interface TraitSummary {
  id: string;
  name: string;
  score: number | null;
  grade: string | null;
}

export interface AttributeSummary {
  id: string;
  name: string;
  icon: string;
  color: string;
  xp: number;
  level: LevelInfo;
  skills: SkillSummary[];
  traits: TraitSummary[];
}

export function skillSummaries(db: DB, now = Date.now()): SkillSummary[] {
  const tree = loadSkillTree(db);
  const profile = getProfile(db);
  const formula = currentFormula(db).params;
  const { bySkill } = xpTotals(db);
  const types = db.select().from(t.measurementTypes).all();
  const assessments = db.select().from(t.assessments).where(isNull(t.assessments.deletedAt)).all();
  const minutes = new Map<string, number>();
  const sessions = new Map<string, number>();
  const live = new Set(
    db
      .select({ id: t.activities.id })
      .from(t.activities)
      .where(isNull(t.activities.deletedAt))
      .all()
      .map((a) => a.id),
  );
  const acts = new Map(db.select().from(t.activities).all().map((a) => [a.id, a]));
  for (const s of db.select().from(t.activitySkills).all()) {
    if (!live.has(s.activityId)) continue;
    const a = acts.get(s.activityId)!;
    minutes.set(s.skillId, (minutes.get(s.skillId) ?? 0) + (a.durationMin * s.weight) / 100);
    sessions.set(s.skillId, (sessions.get(s.skillId) ?? 0) + 1);
  }
  return [...tree.skills.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((s) => {
      const family = tree.withDescendants(s.id);
      let xp = 0;
      let mins = 0;
      let sess = 0;
      for (const id of family) {
        xp += bySkill.get(id) ?? 0;
        mins += minutes.get(id) ?? 0;
        sess += sessions.get(id) ?? 0;
      }
      const p = proficiency(
        s.proficiencyModel,
        s.primaryMeasurementTypeId,
        types.filter((m) => m.skillId === s.id),
        assessments
          .filter((a) => a.skillId === s.id)
          .map((a) => ({
            id: a.id,
            measurementTypeId: a.measurementTypeId,
            assessedAt: a.assessedAt,
            rawValue: a.rawValue,
            rawLabel: a.rawLabel,
            notRepresentative: a.notRepresentative,
            createdAt: a.createdAt,
          })),
      );
      const gp = gradeProgress(p.score, profile.gradeBands);
      return {
        id: s.id,
        name: s.name,
        attributeId: s.attributeId,
        parentId: s.parentId,
        kind: s.kind,
        archived: s.archived,
        ownXp: bySkill.get(s.id) ?? 0,
        xp,
        level: levelFromXp(xp, formula.skillCurve),
        minutes: Math.round(mins),
        sessions: sess,
        proficiency: p.score,
        grade: gradeFor(p.score, profile.gradeBands),
        nextGrade: gp.next,
        gradeProgress: gp.progress,
        assessedAt: p.latestAt,
        stale: p.latestAt !== null && now - p.latestAt > STALE_AFTER_MS,
      };
    });
}

export function traitScores(db: DB, now = Date.now()): Record<"consistency" | "discipline" | "time_management", number | null> {
  const profile = getProfile(db);
  const ts = timeSettings(profile);
  const today = dayKey(now, ts);
  const byDay = new Map<string, number>();
  for (const a of db.select().from(t.activities).where(isNull(t.activities.deletedAt)).all()) {
    const k = dayKey(a.startAt, ts);
    byDay.set(k, (byDay.get(k) ?? 0) + a.durationMin);
  }
  // Discipline: daily quest instances over the window, counting only days the quest was active.
  const dailies = db.select().from(t.quests).where(and(eq(t.quests.kind, "daily"), eq(t.quests.status, "active"))).all();
  const completions = new Set(db.select().from(t.questCompletions).all().map((c) => `${c.questId}|${c.periodKey}`));
  const instances: { completed: boolean }[] = [];
  for (let i = 1; i <= TRAIT_WINDOW_DAYS; i++) {
    const d = addDays(today, -i);
    for (const q of dailies) {
      if (q.createdAt > Date.parse(`${d}T23:59:59Z`)) continue;
      instances.push({ completed: completions.has(`${q.id}|${d}`) });
    }
  }
  if (dailies.some((q) => completions.has(`${q.id}|${today}`))) instances.push({ completed: true });
  return {
    consistency: consistencyScore(byDay, today, profile.restDaysPerWeek),
    discipline: disciplineScore(instances),
    time_management: null, // Tasks arrive with the calendar in milestone 3.
  };
}

export function attributeSummaries(db: DB, now = Date.now()): AttributeSummary[] {
  const formula = currentFormula(db).params;
  const profile = getProfile(db);
  const skills = skillSummaries(db, now);
  const traits = traitScores(db, now);
  return db
    .select()
    .from(t.attributes)
    .where(eq(t.attributes.archived, false))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((attr) => {
      const mine = skills.filter((s) => s.attributeId === attr.id);
      const xp = mine.reduce((s, k) => s + k.ownXp, 0);
      return {
        id: attr.id,
        name: attr.name,
        icon: attr.icon,
        color: attr.color,
        xp,
        level: levelFromXp(xp, formula.characterCurve),
        skills: mine.filter((s) => s.kind === "skill"),
        traits: mine
          .filter((s) => s.kind === "trait")
          .map((s) => {
            const score = traits[s.id as keyof typeof traits] ?? null;
            return { id: s.id, name: s.name, score, grade: gradeFor(score, profile.gradeBands) };
          }),
      };
    });
}

export function characterSummary(db: DB, now = Date.now()) {
  const profile = getProfile(db);
  const formula = currentFormula(db).params;
  const { character } = xpTotals(db);
  const ts = timeSettings(profile);
  const active = new Set(
    db
      .select()
      .from(t.activities)
      .where(isNull(t.activities.deletedAt))
      .all()
      .map((a) => dayKey(a.startAt, ts)),
  );
  const streak = streaks(active, dayKey(now, ts), profile.restDaysPerWeek);
  return { name: profile.characterName, xp: character, level: levelFromXp(character, formula.characterCurve), streak: streak.current };
}

export type QuestState = "locked" | "active" | "completed" | "expired" | "proposed" | "archived";

export interface QuestCard {
  id: string;
  title: string;
  kind: "daily" | "weekly" | "long_term";
  periodKey: string;
  state: QuestState;
  rewardXp: number;
  isSample: boolean;
  stage: { ordinal: number; title: string | null; of: number } | null;
  requirements: { id: string; type: string; title: string | null; progress: number; target: number; met: boolean }[];
  /** Overall progress through the current stage, 0-1. */
  progress: number;
}

export function questBoard(db: DB, now = Date.now()): QuestCard[] {
  const facts = new Facts(db);
  const quests = db.select().from(t.quests).all();
  const completions = db.select().from(t.questCompletions).all();
  return quests
    .filter((q) => q.status !== "archived")
    .map((q) => {
      const key = periodKeyOf(q.kind, now, facts.ts);
      const pe = evaluateQuestPeriod(db, facts, q, key);
      const done = completions.find((c) => c.questId === q.id && c.periodKey === key);
      const ev = pe.evaluation;
      const stageResult = ev ? (ev.stages.find((s) => s.ordinal === ev.currentStage) ?? ev.stages.at(-1)) : undefined;
      const titles = new Map(pe.requirements.map((r) => [r.id, r.title ?? null]));
      const reqs = (stageResult?.requirements ?? []).map((r) => ({ ...r, title: titles.get(r.id) ?? null }));
      const progress = reqs.length ? reqs.reduce((s, r) => s + Math.min(1, r.progress / r.target), 0) / reqs.length : 0;
      const expired = q.kind === "long_term" && q.endAt !== null && now >= q.endAt && !done;
      const state: QuestState = q.status === "proposed" ? "proposed" : pe.locked ? "locked" : done ? "completed" : expired ? "expired" : "active";
      const ordinals = new Set(pe.requirements.map((r) => r.stageOrdinal));
      return {
        id: q.id,
        title: q.title,
        kind: q.kind,
        periodKey: key,
        state,
        rewardXp: q.rewardXp,
        isSample: q.isSample,
        stage: stageResult ? { ordinal: stageResult.ordinal, title: stageResult.title, of: ordinals.size } : null,
        requirements: reqs,
        progress: done ? 1 : progress,
      };
    });
}

export function recentActivities(db: DB, limit = 10) {
  return db.select().from(t.activities).where(isNull(t.activities.deletedAt)).orderBy(desc(t.activities.startAt)).limit(limit).all();
}

export interface MedalCard {
  awardId: string;
  medalId: string;
  name: string;
  occasion: string | null;
  tier: MedalTier;
  xp: number;
  awardedAt: number;
  evidence: string | null;
  origin: "manual" | "linked";
  isSample: boolean;
}

export function medalCase(db: DB): MedalCard[] {
  const medals = new Map(db.select().from(t.medals).all().map((m) => [m.id, m]));
  const tierXp = currentFormula(db).params.medalTierXp;
  return db
    .select()
    .from(t.medalAwards)
    .all()
    .map((a) => {
      const m = medals.get(a.medalId)!;
      const tier = a.tierOverride ?? m.tier;
      return {
        awardId: a.id,
        medalId: m.id,
        name: m.name,
        occasion: a.occasion,
        tier,
        xp: a.xpOverride ?? m.xpReward ?? tierXp[tier],
        awardedAt: a.awardedAt,
        evidence: a.evidence,
        origin: a.origin,
        isSample: a.isSample || m.isSample,
      };
    })
    .sort((a, b) => b.awardedAt - a.awardedAt);
}

export function achievementList(db: DB) {
  const unlocks = new Map(db.select().from(t.achievementUnlocks).all().map((u) => [u.achievementId, u]));
  return db
    .select()
    .from(t.achievements)
    .all()
    .map((a) => {
      const u = unlocks.get(a.id);
      const hiddenLocked = a.hidden && !u;
      return {
        id: a.id,
        name: hiddenLocked ? "Hidden achievement" : a.name,
        description: hiddenLocked ? "Keep going to discover this one." : a.description,
        icon: a.icon,
        unlockedAt: u?.unlockedAt ?? null,
        hidden: a.hidden,
      };
    });
}

export function unreadNotices(db: DB) {
  return db.select().from(t.notices).where(isNull(t.notices.readAt)).orderBy(desc(t.notices.id)).all();
}
