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
      try {
        dailyBackup();
      } catch (e) {
        console.error("Backup failed", e);
      }
    }
  }
  return db;
}
