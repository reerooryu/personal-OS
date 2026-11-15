/**
 * The starting record: real medals and assessments from before ASCEND existed.
 * It lives in private/starting-record.json, which is gitignored because the
 * repository is public. Dates are "YYYY-MM-DD" and are stored as noon in the
 * user's time zone.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { DB } from "@/db/client";
import { DEFAULT_TIMEZONE } from "@/domain/defaults";
import { localToUtc } from "@/domain/time";
import { createAssessment, awardMedal } from "@/services/records";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const startingRecordSchema = z.object({
  characterName: z.string().min(1).optional(),
  medalAwards: z
    .array(
      z.object({
        medalId: z.string(),
        occasionKey: z.string(),
        occasion: z.string(),
        date: day,
        tier: z.enum(["bronze", "silver", "gold"]).optional(),
        skills: z.array(z.object({ skillId: z.string(), weight: z.number().int() })).optional(),
        evidence: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .default([]),
  assessments: z
    .array(
      z.object({
        skillId: z.string(),
        measurementTypeId: z.string(),
        date: day,
        rawValue: z.number().optional(),
        rawLabel: z.string().optional(),
        method: z.enum(["examination", "timed_test", "competition", "formal_assessment", "benchmark", "self_assessment", "school_report"]),
        notes: z.string().optional(),
        evidence: z.string().optional(),
        notRepresentativeReason: z.string().optional(),
      }),
    )
    .default([]),
});
export type StartingRecord = z.output<typeof startingRecordSchema>;

export function noonOn(date: string, tz = DEFAULT_TIMEZONE): number {
  const [y, m, d] = date.split("-").map(Number);
  return localToUtc(tz, y!, m!, d!, 12, 0);
}

export function loadStartingRecord(file = path.join(process.cwd(), "private", "starting-record.json")): StartingRecord | null {
  if (!fs.existsSync(file)) return null;
  return startingRecordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function importStartingRecord(db: DB, record: StartingRecord) {
  for (const m of record.medalAwards) {
    awardMedal(db, {
      medalId: m.medalId,
      occasionKey: m.occasionKey,
      occasion: m.occasion,
      awardedAt: noonOn(m.date),
      tierOverride: m.tier ?? null,
      skillsOverride: m.skills ?? null,
      evidence: m.evidence ?? null,
      notes: m.notes ?? null,
      source: "import",
    });
  }
  for (const a of record.assessments) {
    createAssessment(db, {
      skillId: a.skillId,
      measurementTypeId: a.measurementTypeId,
      assessedAt: noonOn(a.date),
      rawValue: a.rawValue ?? null,
      rawLabel: a.rawLabel ?? null,
      method: a.method,
      notes: a.notes ?? null,
      evidence: a.evidence ?? null,
      notRepresentative: !!a.notRepresentativeReason,
      notRepresentativeReason: a.notRepresentativeReason ?? null,
      source: "import",
    });
  }
}
