/** Skill tree management: create, rename, move, archive and delete skills. */
import { eq, sql } from "drizzle-orm";
import type { DB, Tx } from "@/db/client";
import * as t from "@/db/schema";
import { reconcileAll } from "./engine";
import { ValidationError } from "./errors";

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "skill";

function checkParent(tx: Tx, skillId: string | null, attributeId: string, parentId: string | null) {
  if (!tx.select().from(t.attributes).where(eq(t.attributes.id, attributeId)).get()) throw ValidationError.one("attributeId", "Unknown attribute");
  if (!parentId) return;
  const parent = tx.select().from(t.skills).where(eq(t.skills.id, parentId)).get();
  if (!parent) throw ValidationError.one("parentId", "Unknown parent skill");
  if (parent.kind === "trait") throw ValidationError.one("parentId", "Traits can't have subskills");
  if (parent.attributeId !== attributeId) throw ValidationError.one("parentId", "A subskill must be in the same attribute as its parent");
  // Walk up from the new parent: it must not be the skill itself or one of its descendants.
  let cur: string | null = parentId;
  let depth = 1;
  while (cur) {
    if (cur === skillId) throw ValidationError.one("parentId", "A skill can't be inside itself");
    const row: { parentId: string | null } | undefined = tx.select({ parentId: t.skills.parentId }).from(t.skills).where(eq(t.skills.id, cur)).get();
    cur = row?.parentId ?? null;
    if (++depth > 4) throw ValidationError.one("parentId", "Skills can be nested at most 4 levels deep");
  }
}

export function createSkill(db: DB, input: { name: string; attributeId: string; parentId?: string | null; aliases?: string[] }) {
  const name = input.name.trim();
  if (!name || name.length > 60) throw ValidationError.one("name", "Give the skill a name under 60 characters");
  return db.transaction((tx) => {
    checkParent(tx, null, input.attributeId, input.parentId ?? null);
    let id = slug(name);
    for (let i = 2; tx.select().from(t.skills).where(eq(t.skills.id, id)).get(); i++) id = `${slug(name)}-${i}`;
    const sortOrder = Number(tx.select({ n: sql<number>`coalesce(max(${t.skills.sortOrder}), 0)` }).from(t.skills).get()?.n ?? 0) + 1;
    return tx
      .insert(t.skills)
      .values({ id, name, attributeId: input.attributeId, parentId: input.parentId ?? null, kind: "skill", sortOrder, aliases: input.aliases ?? [] })
      .returning()
      .get();
  });
}

/** Renaming changes the wording of automatic journal entries, so they are refreshed. */
export function renameSkill(db: DB, id: string, name: string) {
  const n = name.trim();
  if (!n || n.length > 60) throw ValidationError.one("name", "Give the skill a name under 60 characters");
  db.transaction((tx) => {
    tx.update(t.skills).set({ name: n }).where(eq(t.skills.id, id)).run();
    reconcileAll(tx);
  });
}

/** Moving keeps all history: roll-ups are computed, so XP simply follows the skill. */
export function moveSkill(db: DB, id: string, attributeId: string, parentId: string | null) {
  db.transaction((tx) => {
    const s = tx.select().from(t.skills).where(eq(t.skills.id, id)).get();
    if (!s) throw ValidationError.one("id", "Skill not found");
    if (s.kind === "trait") throw ValidationError.one("id", "Traits stay in Personal Development");
    checkParent(tx, id, attributeId, parentId);
    const descendants: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const c of tx.select().from(t.skills).where(eq(t.skills.parentId, cur)).all()) {
        descendants.push(c.id);
        stack.push(c.id);
      }
    }
    tx.update(t.skills).set({ attributeId, parentId }).where(eq(t.skills.id, id)).run();
    for (const d of descendants) tx.update(t.skills).set({ attributeId }).where(eq(t.skills.id, d)).run();
    reconcileAll(tx); // quest filters that include subskills may now match differently
  });
}

export function setSkillArchived(db: DB, id: string, archived: boolean) {
  db.update(t.skills).set({ archived }).where(eq(t.skills.id, id)).run();
}

/** Deleting is only allowed for skills with no history. Otherwise archive. */
export function deleteSkill(db: DB, id: string) {
  db.transaction((tx) => {
    const used =
      tx.select().from(t.activitySkills).where(eq(t.activitySkills.skillId, id)).get() ??
      tx.select().from(t.assessments).where(eq(t.assessments.skillId, id)).get() ??
      tx.select().from(t.skills).where(eq(t.skills.parentId, id)).get() ??
      tx.select().from(t.questSkills).where(eq(t.questSkills.skillId, id)).get() ??
      tx.select().from(t.medalSkills).where(eq(t.medalSkills.skillId, id)).get();
    if (used) throw ValidationError.one("id", "This skill has history or subskills. Archive it instead.");
    const planned =
      tx.select().from(t.homework).where(eq(t.homework.skillId, id)).get() ??
      tx.select().from(t.tests).where(eq(t.tests.skillId, id)).get() ??
      tx.select().from(t.timetableSlots).where(eq(t.timetableSlots.skillId, id)).get() ??
      tx.select().from(t.calendarEvents).where(eq(t.calendarEvents.skillId, id)).get();
    if (planned) throw ValidationError.one("id", "Homework, a test or the timetable uses this skill. Archive it instead.");
    // Rules that pointed here would log into nothing: forget them, so the next session asks again.
    tx.delete(t.calendarRules).where(eq(t.calendarRules.skillId, id)).run();
    tx.delete(t.importRules).where(eq(t.importRules.skillId, id)).run();
    tx.delete(t.measurementTypes).where(eq(t.measurementTypes.skillId, id)).run();
    tx.delete(t.skills).where(eq(t.skills.id, id)).run();
  });
}

type Weighted = { skillId: string; weight: number };

/** Replaces `from` with `into` in a skill/weight list, adding weights where both appear. */
function foldWeights(list: Weighted[], from: string, into: string): Weighted[] {
  const out = new Map<string, number>();
  for (const w of list) {
    const id = w.skillId === from ? into : w.skillId;
    out.set(id, Math.min(100, (out.get(id) ?? 0) + w.weight));
  }
  return [...out].map(([skillId, weight]) => ({ skillId, weight }));
}

/**
 * Folds one skill into another: every activity, assessment, measurement,
 * quest, medal, template, rule, timetable slot, homework and test that
 * pointed at `from` points at `into`, subskills move across, the old name
 * becomes an alias, and `from` is deleted. XP is then rebuilt from the
 * activity history, so nothing is lost and nothing is counted twice.
 * `into` keeps its own proficiency model, so a folded-in measurement (a
 * theory grade, say) is kept as history without changing the grade.
 */
export function mergeSkill(db: DB, fromId: string, intoId: string) {
  if (fromId === intoId) throw ValidationError.one("id", "A skill can't be merged into itself");
  db.transaction((tx) => {
    const from = tx.select().from(t.skills).where(eq(t.skills.id, fromId)).get();
    const into = tx.select().from(t.skills).where(eq(t.skills.id, intoId)).get();
    if (!from || !into) throw ValidationError.one("id", "Skill not found");
    if (from.kind === "trait" || into.kind === "trait") throw ValidationError.one("id", "Traits can't be merged");

    // Activities: merge into the existing row when an activity already has both skills.
    for (const row of tx.select().from(t.activitySkills).where(eq(t.activitySkills.skillId, fromId)).all()) {
      const both = tx.select().from(t.activitySkills).where(sql`${t.activitySkills.activityId} = ${row.activityId} and ${t.activitySkills.skillId} = ${intoId}`).get();
      if (both) {
        tx.update(t.activitySkills).set({ weight: Math.min(100, both.weight + row.weight) }).where(sql`${t.activitySkills.activityId} = ${row.activityId} and ${t.activitySkills.skillId} = ${intoId}`).run();
        tx.delete(t.activitySkills).where(sql`${t.activitySkills.activityId} = ${row.activityId} and ${t.activitySkills.skillId} = ${fromId}`).run();
      } else {
        tx.update(t.activitySkills).set({ skillId: intoId }).where(sql`${t.activitySkills.activityId} = ${row.activityId} and ${t.activitySkills.skillId} = ${fromId}`).run();
      }
    }
    // Quest and medal links: same rule.
    for (const row of tx.select().from(t.questSkills).where(eq(t.questSkills.skillId, fromId)).all()) {
      const both = tx.select().from(t.questSkills).where(sql`${t.questSkills.questId} = ${row.questId} and ${t.questSkills.skillId} = ${intoId}`).get();
      if (both) tx.update(t.questSkills).set({ weight: Math.min(100, both.weight + row.weight) }).where(sql`${t.questSkills.questId} = ${row.questId} and ${t.questSkills.skillId} = ${intoId}`).run();
      if (both) tx.delete(t.questSkills).where(sql`${t.questSkills.questId} = ${row.questId} and ${t.questSkills.skillId} = ${fromId}`).run();
      else tx.update(t.questSkills).set({ skillId: intoId }).where(sql`${t.questSkills.questId} = ${row.questId} and ${t.questSkills.skillId} = ${fromId}`).run();
    }
    for (const row of tx.select().from(t.medalSkills).where(eq(t.medalSkills.skillId, fromId)).all()) {
      const both = tx.select().from(t.medalSkills).where(sql`${t.medalSkills.medalId} = ${row.medalId} and ${t.medalSkills.skillId} = ${intoId}`).get();
      if (both) tx.update(t.medalSkills).set({ weight: Math.min(100, both.weight + row.weight) }).where(sql`${t.medalSkills.medalId} = ${row.medalId} and ${t.medalSkills.skillId} = ${intoId}`).run();
      if (both) tx.delete(t.medalSkills).where(sql`${t.medalSkills.medalId} = ${row.medalId} and ${t.medalSkills.skillId} = ${fromId}`).run();
      else tx.update(t.medalSkills).set({ skillId: intoId }).where(sql`${t.medalSkills.medalId} = ${row.medalId} and ${t.medalSkills.skillId} = ${fromId}`).run();
    }
    // Skill lists stored as JSON.
    for (const a of tx.select().from(t.medalAwards).all()) {
      if (a.skillsOverride?.some((w) => w.skillId === fromId)) tx.update(t.medalAwards).set({ skillsOverride: foldWeights(a.skillsOverride, fromId, intoId) }).where(eq(t.medalAwards.id, a.id)).run();
    }
    for (const tpl of tx.select().from(t.activityTemplates).all()) {
      if (tpl.skills.some((w) => w.skillId === fromId)) tx.update(t.activityTemplates).set({ skills: foldWeights(tpl.skills, fromId, intoId) }).where(eq(t.activityTemplates.id, tpl.id)).run();
    }
    for (const r of tx.select().from(t.questRequirements).all()) {
      const ids = r.filter.skillIds;
      if (ids?.includes(fromId)) tx.update(t.questRequirements).set({ filter: { ...r.filter, skillIds: [...new Set(ids.map((x) => (x === fromId ? intoId : x)))] } }).where(eq(t.questRequirements.id, r.id)).run();
    }
    for (const ach of tx.select().from(t.achievements).all()) {
      const p = ach.params as { skillId?: string; skillIds?: string[] };
      if (p.skillId === fromId || p.skillIds?.includes(fromId)) {
        tx.update(t.achievements)
          .set({ params: { ...p, ...(p.skillId === fromId ? { skillId: intoId } : {}), ...(p.skillIds ? { skillIds: [...new Set(p.skillIds.map((x) => (x === fromId ? intoId : x)))] } : {}) } })
          .where(eq(t.achievements.id, ach.id))
          .run();
      }
    }
    // Plain skill columns.
    tx.update(t.measurementTypes).set({ skillId: intoId }).where(eq(t.measurementTypes.skillId, fromId)).run();
    tx.update(t.assessments).set({ skillId: intoId }).where(eq(t.assessments.skillId, fromId)).run();
    tx.update(t.homework).set({ skillId: intoId }).where(eq(t.homework.skillId, fromId)).run();
    tx.update(t.tests).set({ skillId: intoId }).where(eq(t.tests.skillId, fromId)).run();
    tx.update(t.timetableSlots).set({ skillId: intoId }).where(eq(t.timetableSlots.skillId, fromId)).run();
    tx.update(t.calendarEvents).set({ skillId: intoId }).where(eq(t.calendarEvents.skillId, fromId)).run();
    tx.update(t.calendarRules).set({ skillId: intoId }).where(eq(t.calendarRules.skillId, fromId)).run();
    tx.update(t.importRules).set({ skillId: intoId }).where(eq(t.importRules.skillId, fromId)).run();
    tx.update(t.skills).set({ parentId: intoId }).where(eq(t.skills.parentId, fromId)).run();

    // The old name keeps working in pickers and feed matching.
    const aliases = [...new Set([...(into.aliases ?? []), from.name.toLowerCase(), ...(from.aliases ?? [])])].filter((a) => a !== into.name.toLowerCase());
    tx.update(t.skills).set({ aliases }).where(eq(t.skills.id, intoId)).run();
    tx.delete(t.skills).where(eq(t.skills.id, fromId)).run();
    reconcileAll(tx);
  });
}
