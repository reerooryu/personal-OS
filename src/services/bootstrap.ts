/**
 * First-use setup for the desktop app. On the first request the database is
 * seeded (with the bundled starting record, if any), and once a day a backup
 * is written to the data folder, keeping the latest 14.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir, getOpenedDb, type DB } from "@/db/client";
import { seedDatabase } from "@/seed/seed";
import { loadStartingRecord } from "@/seed/starting-record";
import { localToUtc } from "@/domain/time";
import { syncTimetableFile } from "./calendar";
import { getProfile } from "./context";
import { importSchoolworkFromFile } from "./schoolwork";
import { backupTo } from "./data";
import { isSeeded } from "./queries";

const KEEP_BACKUPS = 14;
let booted = false;

function dailyBackup() {
  const opened = getOpenedDb();
  const dir = path.join(dataDir(), "backups");
  const today = new Date().toISOString().slice(0, 10);
  const existing = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".db")).sort() : [];
  if (!existing.some((f) => f.startsWith(`ascend-${today}`))) backupTo(opened, dir);
  const all = fs.readdirSync(dir).filter((f) => f.endsWith(".db")).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.rmSync(path.join(dir, old));
}

export function appDb(): DB {
  const { db } = getOpenedDb();
  if (!booted) {
    booted = true;
    if (process.env.ASCEND_DESKTOP === "1") {
      if (!isSeeded(db)) {
        const record = process.env.ASCEND_STARTING_RECORD ? loadStartingRecord(process.env.ASCEND_STARTING_RECORD) : null;
        seedDatabase(db, { sample: true, startingRecord: record });
      }
      loadTimetable(db, process.env.ASCEND_TIMETABLE);
      try {
        dailyBackup();
      } catch (e) {
        console.error("Backup failed", e);
      }
    } else if (isSeeded(db)) {
      // Development: read the private timetable from the project folder.
      loadTimetable(db, path.join(process.cwd(), "private", "timetable.json"));
    }
  }
  return db;
}

/** Imports private/timetable.json (never in git) when it has changed. */
function loadTimetable(db: DB, file: string | undefined) {
  if (!file || !fs.existsSync(/* turbopackIgnore: true */ file)) return;
  try {
    const text = fs.readFileSync(/* turbopackIgnore: true */ file, "utf8");
    const r = syncTimetableFile(db, text);
    if (r) {
      console.log(`Timetable imported: ${r.slots} slots, ${r.events} events, ${r.breaks} breaks`);
      // Homework and tests listed in the file are added once; after that they belong to the app.
      const zone = getProfile(db).timezone;
      const toUtc = (local: string) => {
        const m = local.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
        if (!m) throw new Error(`Bad date "${local}". Use YYYY-MM-DD HH:MM.`);
        return localToUtc(zone, +m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!);
      };
      const added = importSchoolworkFromFile(db, JSON.parse(text), toUtc);
      if (added) console.log(`Added ${added} homework and tests from the timetable file`);
    }
  } catch (e) {
    console.error("Timetable import failed", e);
  }
}
