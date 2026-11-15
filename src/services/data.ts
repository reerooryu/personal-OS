/**
 * Export and import. An export holds only source records. Importing writes
 * them into an empty database and rebuilds every derived record, so a round
 * trip reproduces identical totals.
 */
import { eq, sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import fs from "node:fs";
import path from "node:path";
import type { DB, OpenedDb } from "@/db/client";
import * as t from "@/db/schema";
import { ChangeLog } from "./context";
import { reconcileAll } from "./engine";
import { ValidationError } from "./errors";

export const EXPORT_FORMAT = "ascend-export";
export const EXPORT_VERSION = 1;

/** Source tables, in an order that satisfies foreign keys on import. */
const SOURCE_TABLES = {
  profile: t.profile,
  appSettings: t.appSettings,
  formulaVersions: t.formulaVersions,
  attributes: t.attributes,
  skills: t.skills,
  activityTypes: t.activityTypes,
  activityTemplates: t.activityTemplates,
  activities: t.activities,
  activitySkills: t.activitySkills,
  revisions: t.revisions,
  measurementTypes: t.measurementTypes,
  assessments: t.assessments,
  quests: t.quests,
  questSkills: t.questSkills,
  questRequirementVersions: t.questRequirementVersions,
  questRequirements: t.questRequirements,
  questPrerequisites: t.questPrerequisites,
  milestoneChecks: t.milestoneChecks,
  medals: t.medals,
  medalSkills: t.medalSkills,
  medalAwards: t.medalAwards,
  achievements: t.achievements,
  journalEntries: t.journalEntries,
  activeTimer: t.activeTimer,
  importRules: t.importRules,
  importItems: t.importItems,
  timetableSlots: t.timetableSlots,
  calendarEvents: t.calendarEvents,
  schoolBreaks: t.schoolBreaks,
  calendarRules: t.calendarRules,
  calendarConfirmations: t.calendarConfirmations,
} satisfies Record<string, SQLiteTable>;

type TableName = keyof typeof SOURCE_TABLES;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: number;
  tables: Record<TableName, Record<string, unknown>[]>;
}

export function exportData(db: DB, now = Date.now()): ExportFile {
  const tables = {} as ExportFile["tables"];
  for (const [name, table] of Object.entries(SOURCE_TABLES) as [TableName, SQLiteTable][]) {
    let rows = db.select().from(table).all() as Record<string, unknown>[];
    // Linked medal awards and untouched automatic journal entries are derived: rebuilt on import.
    if (name === "medalAwards") rows = rows.filter((r) => r.origin === "manual");
    if (name === "journalEntries") rows = rows.filter((r) => r.type === "manual" || r.userEdited);
    tables[name] = rows;
  }
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now, tables };
}

function isEmpty(db: DB): boolean {
  for (const table of [t.activities, t.assessments, t.quests, t.medalAwards, t.skills]) {
    const n = db.select({ n: sql<number>`count(*)` }).from(table).get()?.n ?? 0;
    if (Number(n) > 0) return false;
  }
  return true;
}

export function importData(db: DB, file: ExportFile): ChangeLog {
  if (file.format !== EXPORT_FORMAT) throw ValidationError.one("file", "This isn't an ASCEND export file");
  if (file.version > EXPORT_VERSION) throw ValidationError.one("file", "This export is from a newer version of ASCEND");
  if (!isEmpty(db)) throw ValidationError.one("file", "Import only works into an empty database. Back up and start fresh first.");
  return db.transaction((tx) => {
    tx.delete(t.profile).where(eq(t.profile.id, 1)).run();
    for (const [name, table] of Object.entries(SOURCE_TABLES) as [TableName, SQLiteTable][]) {
      for (const row of file.tables[name] ?? []) tx.insert(table).values(row as never).run();
    }
    return reconcileAll(tx);
  });
}

/** Copies the live database to a timestamped file using SQLite's online backup. */
export function backupTo(opened: OpenedDb, dir: string, now = new Date()): string {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `ascend-${stamp}.db`);
  opened.sqlite.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}
