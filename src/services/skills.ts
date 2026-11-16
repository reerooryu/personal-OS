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
