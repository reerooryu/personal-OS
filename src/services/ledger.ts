/**
 * The XP ledger is append-only. To change a source's XP, we post the
 * difference between what it should be and what the ledger already holds.
 * Posting the same expectation twice writes nothing the second time.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import * as t from "@/db/schema";
import type { ChangeLog } from "./context";

export type SourceType = "activity" | "quest_completion" | "medal_award";

export interface Expected {
  amount: number;
  breakdown?: Record<string, unknown>;
}

/** Key for a ledger target: "character" or "skill:<id>". */
export const CHARACTER = "character";
export const skillKey = (skillId: string) => `skill:${skillId}`;

function parseKey(key: string): { targetType: "character" | "skill"; targetId: string } {
  if (key === CHARACTER) return { targetType: "character", targetId: "" };
  return { targetType: "skill", targetId: key.slice("skill:".length) };
}

export function ledgerFor(tx: Tx, sourceType: SourceType, sourceId: string) {
  const rows = tx
    .select({
      targetType: t.xpEntries.targetType,
      targetId: t.xpEntries.targetId,
      net: sql<number>`sum(${t.xpEntries.amount})`,
      maxSeq: sql<number>`max(${t.xpEntries.seq})`,
    })
    .from(t.xpEntries)
    .where(and(eq(t.xpEntries.sourceType, sourceType), eq(t.xpEntries.sourceId, sourceId)))
    .groupBy(t.xpEntries.targetType, t.xpEntries.targetId)
    .all();
  const out = new Map<string, { net: number; maxSeq: number }>();
  for (const r of rows) {
    out.set(r.targetType === "character" ? CHARACTER : skillKey(r.targetId), { net: Number(r.net), maxSeq: Number(r.maxSeq) });
  }
  return out;
}

export function postDiff(
  tx: Tx,
  sourceType: SourceType,
  sourceId: string,
  expected: Map<string, Expected>,
  formulaVersionId: number | null,
  log: ChangeLog,
): void {
  const existing = ledgerFor(tx, sourceType, sourceId);
  const keys = new Set([...existing.keys(), ...expected.keys()]);
  for (const key of keys) {
    const want = expected.get(key)?.amount ?? 0;
    const have = existing.get(key);
    const diff = want - (have?.net ?? 0);
    if (diff === 0) continue;
    const { targetType, targetId } = parseKey(key);
    tx.insert(t.xpEntries)
      .values({
        sourceType,
        sourceId,
        targetType,
        targetId,
        seq: (have?.maxSeq ?? 0) + 1,
        amount: diff,
        reason: have ? "correction" : "award",
        formulaVersionId,
        breakdown: expected.get(key)?.breakdown ?? null,
      })
      .run();
    log.add(`xp ${sourceType}:${sourceId} ${key} ${diff > 0 ? "+" : ""}${diff}`);
  }
}

/** All source ids of a type that appear in the ledger. */
export function ledgerSourceIds(tx: Tx, sourceType: SourceType): string[] {
  return tx
    .selectDistinct({ id: t.xpEntries.sourceId })
    .from(t.xpEntries)
    .where(eq(t.xpEntries.sourceType, sourceType))
    .all()
    .map((r) => r.id);
}
