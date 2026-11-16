/**
 * The reward moment. Snapshots progression before and after a change and
 * describes what moved: XP, level-ups, grade-ups, quests, medals, achievements.
 * Everything here is read from the ledger, so the celebration never claims
 * more than the engine actually recorded.
 */
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { levelFromXp } from "@/domain/xp";
import { currentFormula, loadSkillTree } from "./context";
import { questBoard, skillSummaries, xpTotals } from "./queries";

interface Snapshot {
  character: number;
  skillXp: Map<string, number>;
  grades: Map<string, string | null>;
  completions: Set<string>;
  unlocks: Set<string>;
  medals: Set<string>;
}

function snapshot(db: DB, now: number): Snapshot {
  const { character } = xpTotals(db);
  const skills = skillSummaries(db, now);
  return {
    character,
    skillXp: new Map(skills.map((s) => [s.id, s.xp])),
    grades: new Map(skills.map((s) => [s.id, s.grade])),
    completions: new Set(db.select().from(t.questCompletions).all().map((c) => `${c.questId}|${c.periodKey}`)),
    unlocks: new Set(db.select().from(t.achievementUnlocks).all().map((u) => u.achievementId)),
    medals: new Set(db.select().from(t.medalAwards).all().map((m) => m.id)),
  };
}

export interface RewardSummary {
  xp: number;
  character: { level: number; leveledUp: boolean; progress: number; toNext: number };
  skills: { id: string; name: string; gained: number; level: number; leveledUp: boolean; toNext: number; progress: number }[];
  gradeUps: { skill: string; from: string | null; to: string }[];
  questsCompleted: string[];
  questsReopened: string[];
  progress: { title: string; text: string; progress: number }[];
  achievements: string[];
  medals: string[];
}

/** `now` is injectable so tests don't depend on which week the real clock is in. */
export function withReward<T>(db: DB, fn: () => T, focusActivityId?: (result: T) => string | null, now = Date.now()): { result: T; reward: RewardSummary } {
  const before = snapshot(db, now);
  const result = fn();
  const after = snapshot(db, now);
  const formula = currentFormula(db).params;
  const tree = loadSkillTree(db);
  const charBefore = levelFromXp(before.character, formula.characterCurve);
  const charAfter = levelFromXp(after.character, formula.characterCurve);

  // Only report leaf skills that actually gained (parents roll up and would repeat the same XP).
  const skills = [...after.skillXp]
    .map(([id, xp]) => ({ id, gained: xp - (before.skillXp.get(id) ?? 0), xp }))
    .filter((s) => s.gained !== 0 && !(tree.children.get(s.id) ?? []).some((c) => (after.skillXp.get(c) ?? 0) !== (before.skillXp.get(c) ?? 0)))
    .map((s) => {
      const b = levelFromXp(s.xp - s.gained, formula.skillCurve);
      const a = levelFromXp(s.xp, formula.skillCurve);
      return { id: s.id, name: tree.skills.get(s.id)?.name ?? s.id, gained: s.gained, level: a.level, leveledUp: a.level > b.level, toNext: a.toNext, progress: a.progress };
    })
    .sort((a, b) => b.gained - a.gained);

  const order = ["F", "E", "D", "C", "B", "A", "S"];
  const rank = (g: string | null | undefined) => (g ? order.indexOf(g) : -1);
  const gradeUps = [...after.grades]
    .filter(([id, g]) => g !== null && rank(g) > rank(before.grades.get(id)))
    .map(([id, g]) => ({ skill: tree.skills.get(id)?.name ?? id, from: before.grades.get(id) ?? null, to: g! }));

  const quests = new Map(db.select().from(t.quests).all().map((q) => [q.id, q.title]));
  const questsCompleted = [...after.completions].filter((k) => !before.completions.has(k)).map((k) => quests.get(k.split("|")[0]!) ?? k);
  const questsReopened = [...before.completions].filter((k) => !after.completions.has(k)).map((k) => quests.get(k.split("|")[0]!) ?? k);

  const achNames = new Map(db.select().from(t.achievements).all().map((a) => [a.id, a.name]));
  const achievements = [...after.unlocks].filter((u) => !before.unlocks.has(u)).map((u) => achNames.get(u) ?? u);
  const medalNames = new Map(db.select().from(t.medals).all().map((m) => [m.id, m.name]));
  const awards = new Map(db.select().from(t.medalAwards).all().map((a) => [a.id, a]));
  const medals = [...after.medals].filter((m) => !before.medals.has(m)).map((m) => awards.get(m)?.occasion ?? medalNames.get(awards.get(m)?.medalId ?? "") ?? m);

  // Progress lines for the quests this activity counted toward.
  const progress: RewardSummary["progress"] = [];
  const focus = focusActivityId?.(result);
  if (focus) {
    const touched = new Set(db.select().from(t.questContributions).where(eq(t.questContributions.activityId, focus)).all().map((c) => c.questId));
    for (const card of questBoard(db, now)) {
      if (!touched.has(card.id) || card.state === "completed") continue;
      const r = card.requirements.find((x) => !x.met) ?? card.requirements[0];
      if (!r) continue;
      const unit = r.type === "duration" ? " min" : r.type === "sessions" ? " sessions" : r.type === "distinct_days" ? " days" : "";
      progress.push({ title: card.title, text: `${Math.round(r.progress)} / ${r.target}${unit}`, progress: card.progress });
    }
  }

  return {
    result,
    reward: {
      xp: after.character - before.character,
      character: { level: charAfter.level, leveledUp: charAfter.level > charBefore.level, progress: charAfter.progress, toNext: charAfter.toNext },
      skills,
      gradeUps,
      questsCompleted,
      questsReopened,
      progress: progress.slice(0, 3),
      achievements,
      medals,
    },
  };
}
