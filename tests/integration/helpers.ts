import { openDb, type DB } from "@/db/client";
import { localToUtc } from "@/domain/time";
import { seedCatalog } from "@/seed/seed";
import { xpTotals } from "@/services/queries";
import type { ActivityInput } from "@/validation/schemas";

export const bkk = (y: number, m: number, d: number, h = 12, min = 0) => localToUtc("Asia/Bangkok", y, m, d, h, min);
/** Sunday 15 November 2026, 18:00 in Bangkok. */
export const NOW = bkk(2026, 11, 15, 18);

export function freshDb(): DB {
  return openDb(":memory:").db;
}

export function seededDb(): DB {
  const db = freshDb();
  seedCatalog(db, "Test");
  return db;
}

let n = 0;
export function piano(minutes: number, startAt: number, extra: Partial<ActivityInput> = {}): ActivityInput {
  return {
    name: "Piano practice",
    startAt,
    durationMin: minutes,
    activityTypeId: "practice",
    difficulty: "normal",
    skills: [{ skillId: "piano", weight: 100 }],
    clientRequestId: `req-${++n}-${Math.random().toString(36).slice(2)}`,
    ...extra,
  };
}

export const characterXp = (db: DB) => xpTotals(db).character;
export const skillXp = (db: DB, id: string) => xpTotals(db).bySkill.get(id) ?? 0;
