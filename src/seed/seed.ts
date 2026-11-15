/** Seeds a fresh database: the catalog, Ryu's starting record, and optional sample activities. */
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { DEFAULT_DAY_BOUNDARY_MINUTES, DEFAULT_FORMULA, DEFAULT_GRADE_BANDS, DEFAULT_TIMEZONE } from "@/domain/defaults";
import { localToUtc } from "@/domain/time";
import { createActivity } from "@/services/activities";
import { reconcileAll } from "@/services/engine";
import { isSeeded } from "@/services/queries";
import { createQuest } from "@/services/records";

export { isSeeded };
import type { ActivityInput } from "@/validation/schemas";
import { ACADEMIC_SKILLS, ACHIEVEMENTS, ACTIVITY_TYPES, ATTRIBUTES, MEASUREMENTS, MEDALS, QUESTS, SKILLS, TEMPLATES } from "./catalog";
import { importStartingRecord, type StartingRecord } from "./starting-record";

export interface SeedOptions {
  now?: number;
  characterName?: string;
  /** Adds two weeks of sample activities, badged as sample data. */
  sample?: boolean;
  startingRecord?: StartingRecord | null;
}

export function seedCatalog(db: DB, characterName = "Ryu") {
  db.transaction((tx) => {
    const formula = tx.insert(t.formulaVersions).values({ params: DEFAULT_FORMULA }).returning().get();
    tx.insert(t.profile)
      .values({
        id: 1,
        characterName,
        timezone: DEFAULT_TIMEZONE,
        dayBoundaryMinutes: DEFAULT_DAY_BOUNDARY_MINUTES,
        currentFormulaVersionId: formula.id,
        gradeBands: DEFAULT_GRADE_BANDS,
        restDaysPerWeek: 1,
        showSampleData: true,
      })
      .run();
    ATTRIBUTES.forEach((a, i) => tx.insert(t.attributes).values({ ...a, sortOrder: i }).run());
    SKILLS.forEach((s, i) =>
      tx
        .insert(t.skills)
        .values({
          id: s.id,
          name: s.name,
          attributeId: s.attributeId,
          parentId: s.parentId ?? null,
          kind: s.kind ?? "skill",
          sortOrder: i,
          proficiencyModel: s.model ?? "primary",
          primaryMeasurementTypeId: s.primary ?? null,
          aliases: s.aliases ?? [],
        })
        .run(),
    );
    ACTIVITY_TYPES.forEach(([id, name], i) => tx.insert(t.activityTypes).values({ id, name, sortOrder: i }).run());
    for (const m of MEASUREMENTS) {
      tx.insert(t.measurementTypes)
        .values({
          id: m.id,
          skillId: m.skillId,
          name: m.name,
          valueKind: m.valueKind,
          unit: m.unit ?? null,
          direction: m.direction,
          anchorLow: m.anchorLow ?? null,
          anchorHigh: m.anchorHigh ?? null,
          gradeScale: m.gradeScale ?? null,
          weight: m.weight,
        })
        .run();
    }
    TEMPLATES.forEach((tpl, i) => tx.insert(t.activityTemplates).values({ ...tpl, sortOrder: i }).run());
    // Equal relative weights: XP is split evenly, with leftover points going to the skills listed first.
    const academicWeights = ACADEMIC_SKILLS.map(([id]) => ({ skillId: id as string, weight: 1 }));
    for (const m of MEDALS) {
      tx.insert(t.medals)
        .values({
          id: m.id,
          name: m.name,
          tier: m.tier,
          repeatable: m.repeatable,
          awardRule: m.awardRule,
          linkedQuestId: "linkedQuestId" in m ? m.linkedQuestId : null,
        })
        .run();
      const skills = m.skills === "academics" ? academicWeights : m.skills;
      for (const s of skills) tx.insert(t.medalSkills).values({ medalId: m.id, ...s }).run();
    }
    for (const a of ACHIEVEMENTS) {
      tx.insert(t.achievements)
        .values({ id: a.id, name: a.name, description: a.description, icon: a.icon, hidden: "hidden" in a ? a.hidden : false, conditionType: a.conditionType, params: a.params })
        .run();
    }
  });
  for (const q of QUESTS) createQuest(db, q);
}

/** Two weeks of plausible sample activities, all flagged as sample data. */
export function seedSampleActivities(db: DB, now: number) {
  const tz = DEFAULT_TIMEZONE;
  const today = new Date(now + 7 * 3_600_000); // Bangkok calendar date
  const plan: [dayOffset: number, hour: number, template: string, minutes: number, difficulty?: ActivityInput["difficulty"]][] = [
    [-13, 17, "tpl-piano", 25],
    [-13, 19, "tpl-maths", 45],
    [-12, 16, "tpl-volleyball", 60, "hard"],
    [-12, 20, "tpl-physics", 40],
    [-11, 17, "tpl-piano", 20],
    [-11, 18, "tpl-gym", 45],
    [-10, 16, "tpl-robotics", 120],
    [-9, 17, "tpl-piano", 30],
    [-9, 19, "tpl-chemistry", 50],
    [-8, 9, "tpl-track", 60, "hard"],
    [-8, 15, "tpl-robotics", 150],
    [-6, 17, "tpl-piano", 20],
    [-6, 19, "tpl-further-maths", 45, "hard"],
    [-5, 16, "tpl-volleyball", 60],
    [-5, 20, "tpl-maths", 30],
    [-4, 17, "tpl-piano", 35],
    [-4, 18, "tpl-gym", 50],
    [-3, 16, "tpl-robotics", 90],
    [-3, 20, "tpl-physics", 45],
    [-2, 17, "tpl-piano", 20],
    [-2, 18, "tpl-volleyball", 60, "hard"],
    [-1, 17, "tpl-theory", 25],
    [-1, 19, "tpl-maths", 60],
  ];
  const templates = new Map(db.select().from(t.activityTemplates).all().map((x) => [x.id, x]));
  for (const [offset, hour, tplId, minutes, difficulty] of plan) {
    const tpl = templates.get(tplId)!;
    const startAt = localToUtc(tz, today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate() + offset, hour, 0);
    createActivity(
      db,
      {
        name: tpl.name,
        startAt,
        durationMin: minutes,
        activityTypeId: tpl.activityTypeId,
        difficulty: difficulty ?? (tpl.difficulty as ActivityInput["difficulty"]),
        skills: tpl.skills,
        templateId: tpl.id,
        isSample: true,
        clientRequestId: `sample:${offset}:${hour}:${tplId}`,
      },
      now,
    );
  }
}

export function seedDatabase(db: DB, opts: SeedOptions = {}) {
  if (isSeeded(db)) throw new Error("The database already has data. Seeding only works on a fresh database.");
  const now = opts.now ?? Date.now();
  seedCatalog(db, opts.startingRecord?.characterName ?? opts.characterName ?? "Ryu");
  if (opts.startingRecord) importStartingRecord(db, opts.startingRecord);
  if (opts.sample) seedSampleActivities(db, now);
  db.transaction((tx) => reconcileAll(tx));
}

/** Removes every record flagged as sample data, then rebuilds derived data. */
export function clearSampleData(db: DB) {
  db.transaction((tx) => {
    const ids = tx
      .select({ id: t.activities.id })
      .from(t.activities)
      .where(eq(t.activities.isSample, true))
      .all()
      .map((a) => a.id);
    for (const id of ids) {
      tx.delete(t.activitySkills).where(eq(t.activitySkills.activityId, id)).run();
      tx.delete(t.journalEntries).where(eq(t.journalEntries.activityId, id)).run();
      tx.delete(t.activities).where(eq(t.activities.id, id)).run();
    }
    tx.delete(t.assessments).where(eq(t.assessments.isSample, true)).run();
    tx.delete(t.medalAwards).where(eq(t.medalAwards.isSample, true)).run();
    tx.update(t.profile).set({ showSampleData: false }).where(eq(t.profile.id, 1)).run();
    reconcileAll(tx);
  });
}
