/** Small key/value settings stored in app_settings. */
import { eq } from "drizzle-orm";
import type { DB, Tx } from "@/db/client";
import * as t from "@/db/schema";

export interface Settings {
  /** Record clicks and page views for the usage log. On by default. */
  usageLog: boolean;
  /** Folder watched for Apple Health export files. */
  healthFolder: string | null;
  /** Files already read: path → modified time. */
  healthFiles: Record<string, number>;
  /** Last scan: when, and what went wrong if anything. */
  healthLastScan: { at: number; error: string | null; added: number } | null;
  /** Monday (YYYY-MM-DD) of any Week 1. Rotation alternates every week from there. */
  weekAnchor: string | null;
  /** The pupil's private SOCS calendar feed (webcal:// or https://). Never in git. */
  socsFeedUrl: string | null;
  socsLastFetch: { at: number; error: string | null; count: number } | null;
  /** Result of the last write to Apple Calendar, reported by the desktop app. */
  appleSync: { at: number; ok: boolean; error: string | null; added: number; updated: number; removed: number; calendar: string | null } | null;
  /** Hash of the last imported private timetable file, so it is imported again only when it changes. */
  timetableHash: string | null;
  /** When the calendar was first set up. "Did you go?" never asks about anything before it. */
  calendarSince: number | null;
}

const DEFAULTS: Settings = {
  usageLog: true,
  healthFolder: null,
  healthFiles: {},
  healthLastScan: null,
  weekAnchor: null,
  socsFeedUrl: null,
  socsLastFetch: null,
  appleSync: null,
  timetableHash: null,
  calendarSince: null,
};

export function getSetting<K extends keyof Settings>(db: DB | Tx, key: K): Settings[K] {
  const row = db.select().from(t.appSettings).where(eq(t.appSettings.key, key)).get();
  return row ? (row.value as Settings[K]) : DEFAULTS[key];
}

export function setSetting<K extends keyof Settings>(db: DB | Tx, key: K, value: Settings[K]): void {
  db.insert(t.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: t.appSettings.key, set: { value } })
    .run();
}
