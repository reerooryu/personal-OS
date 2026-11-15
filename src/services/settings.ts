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
}

const DEFAULTS: Settings = { usageLog: true, healthFolder: null, healthFiles: {}, healthLastScan: null };

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
