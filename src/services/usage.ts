/**
 * The usage log. Ryu knows it exists and can switch it off in Settings.
 *
 * It records what was opened and clicked, how long logging took, forms given
 * up on and errors, so the app can be made easier to use. It never records
 * what was typed: the browser side sends field names, never field values, and
 * this side caps every string so nothing long can slip in.
 */
import { and, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { getSetting } from "./settings";

const KEEP_DAYS = 365;
const MAX_BATCH = 200;

const short = (n: number) => z.string().transform((s) => s.slice(0, n));
const eventSchema = z.object({
  at: z.number().int().positive(),
  sessionId: short(40),
  kind: z.enum(["view", "click", "select", "edit", "submit", "open", "save", "abandon", "error", "warning"]),
  name: short(80),
  path: short(120).nullish(),
  ms: z.number().int().min(0).max(86_400_000).nullish(),
  meta: z
    .record(z.string().max(30), z.union([short(80), z.number(), z.boolean()]))
    .refine((m) => Object.keys(m).length <= 8, "Too many meta keys")
    .nullish(),
});
export type UsageEvent = z.input<typeof eventSchema>;

/** Saves a batch from the browser. Silently drops everything when the log is off. */
export function recordUsage(db: DB, raw: unknown[], now = Date.now()): number {
  if (!getSetting(db, "usageLog")) return 0;
  const rows = [];
  for (const r of raw.slice(0, MAX_BATCH)) {
    const p = eventSchema.safeParse(r);
    if (!p.success) continue;
    // Clamp clock skew: an event can't be from the future or older than a day.
    const at = Math.min(Math.max(p.data.at, now - 86_400_000), now);
    rows.push({ ...p.data, at, path: p.data.path ?? null, ms: p.data.ms ?? null, meta: p.data.meta ?? null });
  }
  if (rows.length) db.insert(t.usageEvents).values(rows).run();
  db.delete(t.usageEvents).where(lt(t.usageEvents.at, now - KEEP_DAYS * 86_400_000)).run();
  return rows.length;
}

export function clearUsage(db: DB): void {
  db.delete(t.usageEvents).run();
}

export function usageEvents(db: DB, sinceMs = 0) {
  return db.select().from(t.usageEvents).where(gte(t.usageEvents.at, sinceMs)).orderBy(t.usageEvents.at).all();
}

/** A new session starts after this much inactivity. */
export const SESSION_GAP_MS = 30 * 60_000;

/**
 * Counts sessions as bursts of use. Ryu leaves the app open for days (one
 * page load ran from Monday evening to Tuesday night), so a page load is not
 * a session: 30 minutes without any event is.
 */
export function countSessions(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  let n = 0;
  let last = -Infinity;
  for (const at of sorted) {
    if (at - last > SESSION_GAP_MS) n++;
    last = at;
  }
  return n;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

/** A friction summary for Settings: the last `days` days. */
export function usageSummary(db: DB, now = Date.now(), days = 7) {
  const since = now - days * 86_400_000;
  const ev = db
    .select()
    .from(t.usageEvents)
    .where(and(gte(t.usageEvents.at, since), lt(t.usageEvents.at, now + 1)))
    .all();
  const total = db.select({ n: sql<number>`count(*)` }).from(t.usageEvents).get()?.n ?? 0;
  const logs = ev.filter((e) => e.kind === "save");
  const pages = new Map<string, { views: number; ms: number }>();
  for (const e of ev.filter((e) => e.kind === "view")) {
    const p = pages.get(e.name) ?? { views: 0, ms: 0 };
    p.views++;
    p.ms += e.ms ?? 0;
    pages.set(e.name, p);
  }
  return {
    enabled: getSetting(db, "usageLog"),
    days,
    totalStored: total,
    events: ev.length,
    sessions: countSessions(ev.map((e) => e.at)),
    logs: logs.length,
    medianLogMs: median(logs.map((e) => e.ms).filter((m): m is number => m != null)),
    abandoned: ev.filter((e) => e.kind === "abandon").length,
    warnings: ev.filter((e) => e.kind === "warning").length,
    errors: ev.filter((e) => e.kind === "error").length,
    topPages: [...pages.entries()]
      .sort((a, b) => b[1].views - a[1].views)
      .slice(0, 5)
      .map(([path, p]) => ({ path, views: p.views, avgSec: Math.round(p.ms / p.views / 1000) })),
    recentErrors: ev
      .filter((e) => e.kind === "error")
      .slice(-3)
      .map((e) => ({ at: e.at, name: e.name, path: e.path })),
  };
}

/** CSV for spreadsheets: one row per event. */
export function usageCsv(db: DB): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ["time,session,kind,name,path,ms,meta"];
  for (const e of usageEvents(db)) lines.push([new Date(e.at).toISOString(), e.sessionId, e.kind, e.name, e.path, e.ms, e.meta].map(esc).join(","));
  return lines.join("\n") + "\n";
}
