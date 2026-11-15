/** Shared lookups used by the services. Reads only. */
import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import * as t from "@/db/schema";
import type { FormulaParams } from "@/domain/types";
import type { TimeSettings } from "@/domain/time";

export type Profile = typeof t.profile.$inferSelect;
export type SkillRow = typeof t.skills.$inferSelect;

export function getProfile(tx: Tx): Profile {
  const p = tx.select().from(t.profile).where(eq(t.profile.id, 1)).get();
  if (!p) throw new Error("Profile missing. Run the seed first.");
  return p;
}

export function timeSettings(p: Profile): TimeSettings {
  return { timezone: p.timezone, dayBoundaryMinutes: p.dayBoundaryMinutes };
}

const formulaCache = new WeakMap<object, Map<number, FormulaParams>>();

export function getFormula(tx: Tx, id: number): FormulaParams {
  let cache = formulaCache.get(tx);
  if (!cache) {
    cache = new Map();
    formulaCache.set(tx, cache);
  }
  const hit = cache.get(id);
  if (hit) return hit;
  const row = tx.select().from(t.formulaVersions).where(eq(t.formulaVersions.id, id)).get();
  if (!row) throw new Error(`Formula version ${id} not found`);
  cache.set(id, row.params);
  return row.params;
}

export function currentFormula(tx: Tx): { id: number; params: FormulaParams } {
  const p = getProfile(tx);
  return { id: p.currentFormulaVersionId, params: getFormula(tx, p.currentFormulaVersionId) };
}

export interface SkillTree {
  skills: Map<string, SkillRow>;
  children: Map<string, string[]>;
  /** The skill and every descendant. */
  withDescendants(skillId: string): Set<string>;
  /** Every skill under an attribute. */
  ofAttribute(attributeId: string): Set<string>;
}

export function loadSkillTree(tx: Tx): SkillTree {
  const rows = tx.select().from(t.skills).all();
  const skills = new Map(rows.map((r) => [r.id, r]));
  const children = new Map<string, string[]>();
  for (const r of rows) {
    if (r.parentId) children.set(r.parentId, [...(children.get(r.parentId) ?? []), r.id]);
  }
  const withDescendants = (skillId: string) => {
    const out = new Set<string>();
    const stack = [skillId];
    while (stack.length) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      stack.push(...(children.get(id) ?? []));
    }
    return out;
  };
  const ofAttribute = (attributeId: string) => new Set(rows.filter((r) => r.attributeId === attributeId).map((r) => r.id));
  return { skills, children, withDescendants, ofAttribute };
}

/** Collects a human-readable list of what a reconcile changed. */
export class ChangeLog {
  readonly items: string[] = [];
  add(msg: string) {
    this.items.push(msg);
  }
  get count() {
    return this.items.length;
  }
}
