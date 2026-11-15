/**
 * Quest evaluation. Pure and deterministic: the same facts always give the
 * same progress, contributions and completion time.
 */
import { difficultyRank, type RequirementFilter, type WeightedSkill } from "./types";

export type RequirementType = "duration" | "sessions" | "distinct_days" | "assessment" | "milestone" | "subquests";

export interface RequirementDef {
  id: string;
  stageOrdinal: number;
  stageTitle?: string | null;
  type: RequirementType;
  title?: string | null;
  /** Minutes, sessions, days, a 0-100 score, 1 for a milestone, or a count of sub-quests. */
  target: number;
  filter: RequirementFilter;
  /** Skills that qualify, with subskills already expanded. Null means any skill. */
  matchSkills: Set<string> | null;
  measurementTypeId?: string | null;
  subQuestIds?: string[] | null;
}

export interface ActivityFact {
  id: string;
  startAt: number;
  durationMin: number;
  activityTypeId: string;
  difficulty: string;
  skills: WeightedSkill[];
  dayKey: string;
}

export interface AssessmentEvent {
  id: string;
  measurementTypeId: string;
  at: number;
  score: number;
}

export interface QuestFacts {
  requirements: RequirementDef[];
  window: { start: number; end: number };
  activities: ActivityFact[];
  assessments: AssessmentEvent[];
  /** requirementId -> time the milestone was ticked. */
  milestoneChecks: Map<string, number>;
  /** sub-quest id -> completion time. */
  subQuestCompletions: Map<string, number>;
}

export interface RequirementProgress {
  id: string;
  type: RequirementType;
  progress: number;
  target: number;
  met: boolean;
}

export interface StageResult {
  ordinal: number;
  title: string | null;
  startedAt: number;
  completedAt: number | null;
  requirements: RequirementProgress[];
}

export interface Contribution {
  requirementId: string;
  activityId: string;
  amount: number;
  stageOrdinal: number;
}

export interface QuestEvaluation {
  stages: StageResult[];
  contributions: Contribution[];
  completedAt: number | null;
  completedByRef: string | null;
  /** Ordinal of the stage currently accepting progress, or null when complete. */
  currentStage: number | null;
}

const EPS = 1e-9;

/** Share (0-1) of an activity that belongs to the requirement's skills. */
export function matchingFraction(activity: ActivityFact, matchSkills: Set<string> | null): number {
  if (matchSkills === null) return 1;
  const w = activity.skills.reduce((s, k) => s + (matchSkills.has(k.skillId) ? k.weight : 0), 0);
  return w / 100;
}

export function activityQualifies(activity: ActivityFact, req: RequirementDef): boolean {
  const f = req.filter;
  if (f.activityTypeIds?.length && !f.activityTypeIds.includes(activity.activityTypeId)) return false;
  if (f.minDifficulty && difficultyRank(activity.difficulty) < difficultyRank(f.minDifficulty)) return false;
  if (f.minSessionMinutes && activity.durationMin < f.minSessionMinutes) return false;
  return matchingFraction(activity, req.matchSkills) > EPS;
}

type Event =
  | { kind: "activity"; at: number; end: number; ref: string; activity: ActivityFact }
  | { kind: "assessment"; at: number; end: number; ref: string; assessment: AssessmentEvent }
  | { kind: "milestone"; at: number; end: number; ref: string; requirementId: string }
  | { kind: "subquest"; at: number; end: number; ref: string; questId: string };

const KIND_ORDER = { activity: 0, assessment: 1, milestone: 2, subquest: 3 } as const;

export function evaluateQuest(facts: QuestFacts): QuestEvaluation {
  const ordinals = [...new Set(facts.requirements.map((r) => r.stageOrdinal))].sort((a, b) => a - b);
  const stages: StageResult[] = [];
  const contributions: Contribution[] = [];
  let stageStart = facts.window.start;
  let completedAt: number | null = null;
  let completedByRef: string | null = null;
  let currentStage: number | null = null;

  for (const ordinal of ordinals) {
    const reqs = facts.requirements.filter((r) => r.stageOrdinal === ordinal);
    const progress = new Map<string, number>(reqs.map((r) => [r.id, 0]));
    const days = new Map<string, Set<string>>(reqs.map((r) => [r.id, new Set()]));
    const doneSubs = new Map<string, Set<string>>(reqs.map((r) => [r.id, new Set()]));

    const events: Event[] = [];
    for (const a of facts.activities) {
      if (a.startAt >= stageStart && a.startAt < facts.window.end) {
        events.push({ kind: "activity", at: a.startAt, end: a.startAt + a.durationMin * 60_000, ref: a.id, activity: a });
      }
    }
    for (const s of facts.assessments) {
      if (s.at >= stageStart && s.at < facts.window.end) {
        events.push({ kind: "assessment", at: s.at, end: s.at, ref: s.id, assessment: s });
      }
    }
    for (const r of reqs) {
      if (r.type === "milestone") {
        const t = facts.milestoneChecks.get(r.id);
        if (t !== undefined && t < facts.window.end) {
          const at = Math.max(t, stageStart);
          events.push({ kind: "milestone", at, end: at, ref: `milestone:${r.id}`, requirementId: r.id });
        }
      }
      if (r.type === "subquests") {
        for (const q of r.subQuestIds ?? []) {
          const t = facts.subQuestCompletions.get(q);
          if (t !== undefined && t < facts.window.end) {
            const at = Math.max(t, stageStart);
            events.push({ kind: "subquest", at, end: at, ref: `quest:${q}`, questId: q });
          }
        }
      }
    }
    events.sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

    const isMet = (r: RequirementDef) => (progress.get(r.id) ?? 0) + EPS >= r.target;
    let stageDone: number | null = null;
    let doneRef: string | null = null;

    for (const ev of events) {
      for (const r of reqs) {
        if (isMet(r)) continue;
        if (ev.kind === "activity" && (r.type === "duration" || r.type === "sessions" || r.type === "distinct_days")) {
          if (!activityQualifies(ev.activity, r)) continue;
          let amount = 0;
          if (r.type === "duration") amount = ev.activity.durationMin * matchingFraction(ev.activity, r.matchSkills);
          if (r.type === "sessions") amount = 1;
          if (r.type === "distinct_days") {
            const seen = days.get(r.id)!;
            amount = seen.has(ev.activity.dayKey) ? 0 : 1;
            seen.add(ev.activity.dayKey);
          }
          if (amount > EPS) {
            progress.set(r.id, (progress.get(r.id) ?? 0) + amount);
            contributions.push({ requirementId: r.id, activityId: ev.activity.id, amount, stageOrdinal: ordinal });
          }
        } else if (ev.kind === "assessment" && r.type === "assessment") {
          if (ev.assessment.measurementTypeId !== r.measurementTypeId) continue;
          progress.set(r.id, Math.max(progress.get(r.id) ?? 0, ev.assessment.score));
        } else if (ev.kind === "milestone" && r.type === "milestone" && ev.requirementId === r.id) {
          progress.set(r.id, 1);
        } else if (ev.kind === "subquest" && r.type === "subquests" && r.subQuestIds?.includes(ev.questId)) {
          const set = doneSubs.get(r.id)!;
          set.add(ev.questId);
          progress.set(r.id, set.size);
        }
      }
      if (reqs.every(isMet)) {
        stageDone = ev.end;
        doneRef = ev.ref;
        break;
      }
    }

    stages.push({
      ordinal,
      title: reqs[0]?.stageTitle ?? null,
      startedAt: stageStart,
      completedAt: stageDone,
      requirements: reqs.map((r) => ({
        id: r.id,
        type: r.type,
        progress: progress.get(r.id) ?? 0,
        target: r.target,
        met: isMet(r),
      })),
    });

    if (stageDone === null) {
      currentStage = ordinal;
      break;
    }
    stageStart = stageDone;
    completedAt = stageDone;
    completedByRef = doneRef;
  }

  if (stages.length < ordinals.length || currentStage !== null) {
    completedAt = null;
    completedByRef = null;
  }
  return { stages, contributions, completedAt, completedByRef, currentStage };
}
