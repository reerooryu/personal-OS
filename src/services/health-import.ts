/**
 * Apple Health workout import.
 *
 * Route: Garmin watch → Garmin Connect → Apple Health → an iPhone export app
 * (Health Auto Export) → JSON files in iCloud Drive → this module.
 *
 * Every workout seen becomes an import item. Known workout types are logged
 * as activities straight away; new types wait in the review list until Ryu
 * picks a skill or ignores them. A workout that overlaps something he already
 * logged by hand is matched to it instead of being counted twice.
 */
import { and, eq, isNull, ne } from "drizzle-orm";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import type { WorkoutDetails } from "@/db/schema";
import { MAX_DURATION_MIN } from "@/domain/defaults";
import type { Difficulty } from "@/domain/types";
import { createActivity, deleteActivity } from "./activities";
import { ValidationError } from "./errors";
import { getSetting, setSetting } from "./settings";

export const PROVIDER = "apple_health";
const MIN_MINUTES = 5;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface Workout {
  externalId: string;
  workoutType: string;
  startAt: number;
  durationMin: number;
  details: WorkoutDetails;
}

// ------------------------------------------------------------------ parsing ---

/** "2024-02-06 07:00:00 -0800" (Health Auto Export) or any ISO date. */
export function parseHealthDate(v: unknown): number | null {
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})$/);
  const iso = m ? `${m[1]}T${m[2]!.length === 5 ? `${m[2]}:00` : m[2]}${m[3]}:${m[4]}` : v;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

type Qty = { qty?: unknown; units?: unknown } | undefined;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

function km(q: Qty): number | undefined {
  const n = num(q?.qty);
  if (n === undefined) return undefined;
  const u = String(q?.units ?? "km").toLowerCase();
  const v = u === "mi" ? n * 1.609344 : u === "m" ? n / 1000 : u === "yd" ? n * 0.0009144 : n;
  return Math.round(v * 100) / 100;
}

function kcal(q: Qty): number | undefined {
  const n = num(q?.qty);
  if (n === undefined) return undefined;
  return Math.round(String(q?.units ?? "kcal").toLowerCase() === "kj" ? n / 4.184 : n);
}

/** Normalizes a workout type for matching: "Pool Swim " → "pool swim". */
export const typeKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Reads one export file. Accepts Health Auto Export v1 and v2
 * ({ data: { workouts } }), a bare { workouts } object, or a top-level array.
 */
export function parseHealthExport(json: unknown): Workout[] {
  const o = json as Record<string, unknown> | unknown[];
  const list: unknown[] = Array.isArray(o)
    ? o
    : Array.isArray((o as { data?: { workouts?: unknown } })?.data?.workouts)
      ? ((o as { data: { workouts: unknown[] } }).data.workouts)
      : Array.isArray((o as { workouts?: unknown })?.workouts)
        ? (o as { workouts: unknown[] }).workouts
        : [];
  const out: Workout[] = [];
  for (const raw of list) {
    const w = raw as Record<string, unknown>;
    const name = String(w.name ?? w.workoutActivityType ?? w.activityType ?? w.type ?? "").trim();
    const start = parseHealthDate(w.start ?? w.startDate);
    const end = parseHealthDate(w.end ?? w.endDate);
    if (!name || start === null) continue;
    // v2 gives duration in seconds, excluding pauses. Fall back to end - start.
    const span = end !== null ? (end - start) / 1000 : undefined;
    let seconds = num(w.duration);
    if (seconds === undefined || (span !== undefined && seconds > span + 60)) seconds = span;
    if (seconds === undefined) continue;
    const durationMin = Math.round(seconds / 60);
    if (durationMin < MIN_MINUTES || durationMin > MAX_DURATION_MIN) continue;
    const hr = w.heartRate as { avg?: Qty; max?: Qty } | undefined;
    const details: WorkoutDetails = {
      distanceKm: km(w.distance as Qty),
      kcal: kcal((w.activeEnergyBurned ?? w.activeEnergy) as Qty),
      avgHr: num(hr?.avg?.qty ?? (w.avgHeartRate as Qty)?.qty),
      maxHr: num(hr?.max?.qty ?? (w.maxHeartRate as Qty)?.qty),
      location: typeof w.location === "string" ? w.location : undefined,
      sourceName: typeof (w.source as { name?: unknown })?.name === "string" ? (w.source as { name: string }).name : undefined,
    };
    for (const k of Object.keys(details) as (keyof WorkoutDetails)[]) if (details[k] === undefined) delete details[k];
    if (details.avgHr !== undefined) details.avgHr = Math.round(details.avgHr);
    if (details.maxHr !== undefined) details.maxHr = Math.round(details.maxHr);
    // Keyed by type and start minute, not the HealthKit id: Garmin Connect is known
    // to rewrite its workouts in Apple Health, which gives them new ids.
    out.push({ externalId: `${typeKey(name)}@${Math.round(start / 60_000)}`, workoutType: name, startAt: start, durationMin, details });
  }
  return out;
}

// ---------------------------------------------------------------- rules ---

/** Obvious workout types are mapped on first sight. Anything else goes to review. */
const AUTO_RULES: { test: RegExp; skillId: string }[] = [
  { test: /tennis|squash|badminton|padel|pickleball/, skillId: "tennis" },
  { test: /swim/, skillId: "swimming" },
  { test: /volleyball/, skillId: "volleyball" },
  { test: /strength|weight|gym|hiit|high intensity|core training|cross ?training|functional/, skillId: "gym" },
  { test: /\brun|track|sprint|athletics/, skillId: "track" },
];

export function suggestSkill(workoutType: string): string | null {
  const k = typeKey(workoutType);
  return AUTO_RULES.find((r) => r.test.test(k))?.skillId ?? null;
}

function ruleFor(db: DB, workoutType: string) {
  return db.select().from(t.importRules).where(eq(t.importRules.workoutType, typeKey(workoutType))).get() ?? null;
}

function skillExists(db: DB, id: string) {
  const s = db.select().from(t.skills).where(eq(t.skills.id, id)).get();
  return !!s && !s.archived && s.kind !== "trait";
}

/** Guesses effort from average heart rate. Conservative: most sessions stay Normal. */
export function difficultyFromHr(avgHr: number | undefined): Difficulty {
  if (avgHr === undefined) return "normal";
  if (avgHr >= 175) return "very_hard";
  if (avgHr >= 155) return "hard";
  if (avgHr < 105) return "easy";
  return "normal";
}

function summary(d: WorkoutDetails): string {
  const parts = [
    d.distanceKm ? `${d.distanceKm} km` : null,
    d.kcal ? `${d.kcal} kcal` : null,
    d.avgHr ? `avg HR ${d.avgHr}` : null,
    d.maxHr ? `max HR ${d.maxHr}` : null,
  ].filter(Boolean);
  return `From Apple Health${d.sourceName ? ` (${d.sourceName})` : ""}${parts.length ? `: ${parts.join(" · ")}` : ""}.`;
}

// --------------------------------------------------------------- applying ---

type Item = typeof t.importItems.$inferSelect;

/** A hand-logged activity that covers most of the same time on the same skill. */
function overlappingManual(db: DB, item: Item, skillId: string) {
  const start = item.startAt;
  const end = start + item.durationMin * 60_000;
  const candidates = db
    .select()
    .from(t.activities)
    .where(and(isNull(t.activities.deletedAt), ne(t.activities.source, "import")))
    .all()
    .filter((a) => a.startAt < end && a.startAt + a.durationMin * 60_000 > start);
  for (const a of candidates) {
    const overlap = Math.min(end, a.startAt + a.durationMin * 60_000) - Math.max(start, a.startAt);
    const shorter = Math.min(item.durationMin, a.durationMin) * 60_000;
    if (overlap < shorter * 0.5) continue;
    const skills = db.select().from(t.activitySkills).where(eq(t.activitySkills.activityId, a.id)).all();
    if (skills.some((s) => s.skillId === skillId)) return a;
  }
  return null;
}

function logItem(db: DB, item: Item, skillId: string, activityTypeId: string, now: number): { status: "imported" | "matched"; xp: number } {
  const match = overlappingManual(db, item, skillId);
  if (match) {
    db.update(t.importItems).set({ status: "matched", activityId: match.id, decidedAt: now }).where(eq(t.importItems.id, item.id)).run();
    return { status: "matched", xp: 0 };
  }
  // If an earlier import of this workout was deleted (sent back to review), give the new one a fresh id.
  let externalId = `${PROVIDER}:${item.externalId}`;
  const old = db.select().from(t.activities).where(and(eq(t.activities.source, "import"), eq(t.activities.externalId, externalId))).get();
  if (old?.deletedAt != null) externalId += `:${now}`;
  const r = createActivity(
    db,
    {
      name: item.workoutType,
      notes: summary(item.details),
      startAt: item.startAt,
      durationMin: item.durationMin,
      activityTypeId,
      difficulty: difficultyFromHr(item.details.avgHr),
      skills: [{ skillId, weight: 100 }],
      source: "import",
      externalId,
      confirmLong: true, // measured by the watch, not a forgotten timer
    },
    now,
  );
  db.update(t.importItems).set({ status: "imported", activityId: r.activity.id, decidedAt: now }).where(eq(t.importItems.id, item.id)).run();
  return { status: "imported", xp: r.created ? r.xp : 0 };
}

/** Applies rules to pending items. Returns what happened, for the notice. */
export function processPending(db: DB, now = Date.now()) {
  let imported = 0;
  let matched = 0;
  let xp = 0;
  for (const item of db.select().from(t.importItems).where(eq(t.importItems.status, "pending")).all()) {
    const rule = ruleFor(db, item.workoutType);
    if (!rule) continue;
    if (rule.action === "ignore") {
      db.update(t.importItems).set({ status: "ignored", decidedAt: now }).where(eq(t.importItems.id, item.id)).run();
      continue;
    }
    if (!rule.skillId || !skillExists(db, rule.skillId)) continue; // skill archived or deleted: leave it for review
    const r = logItem(db, item, rule.skillId, rule.activityTypeId ?? "training", now);
    if (r.status === "imported") imported++;
    else matched++;
    xp += r.xp;
  }
  return { imported, matched, xp };
}

/** Records new workouts and applies rules. Workouts seen before are skipped. */
export function ingestWorkouts(db: DB, workouts: Workout[], fileName: string | null, now = Date.now()) {
  let added = 0;
  for (const w of workouts) {
    if (w.startAt > now) continue;
    const exists = db
      .select()
      .from(t.importItems)
      .where(and(eq(t.importItems.provider, PROVIDER), eq(t.importItems.externalId, w.externalId)))
      .get();
    if (exists) continue;
    db.insert(t.importItems)
      .values({ id: randomUUID(), provider: PROVIDER, externalId: w.externalId, workoutType: w.workoutType, startAt: w.startAt, durationMin: w.durationMin, details: w.details, status: "pending", fileName, createdAt: now })
      .run();
    added++;
    // First sight of an obvious type: create its rule so it imports by itself from now on.
    if (!ruleFor(db, w.workoutType)) {
      const skillId = suggestSkill(w.workoutType);
      if (skillId && skillExists(db, skillId)) {
        db.insert(t.importRules).values({ workoutType: typeKey(w.workoutType), action: "log", skillId, activityTypeId: "training", createdAt: now }).run();
      }
    }
  }
  const result = processPending(db, now);
  const waiting = pendingImports(db).length;
  if (added) {
    const parts = [
      result.imported ? `logged ${result.imported} workout${result.imported === 1 ? "" : "s"} (+${result.xp} XP)` : null,
      result.matched ? `matched ${result.matched} to sessions you already logged` : null,
      waiting ? `${waiting} need${waiting === 1 ? "s" : ""} a skill` : null,
    ].filter(Boolean);
    if (parts.length) db.insert(t.notices).values({ kind: "health_import", message: `Apple Health: ${parts.join(", ")}.` }).run();
  }
  return { added, ...result, waiting };
}

// ----------------------------------------------------------------- review ---

export function pendingImports(db: DB) {
  return db
    .select()
    .from(t.importItems)
    .where(eq(t.importItems.status, "pending"))
    .all()
    .sort((a, b) => b.startAt - a.startAt)
    .map((i) => ({ ...i, suggestedSkillId: ruleFor(db, i.workoutType)?.skillId ?? suggestSkill(i.workoutType) }));
}

export interface ImportDecision {
  itemId: string;
  action: "log" | "ignore";
  skillId?: string;
  /** Also apply to every future workout of this type. */
  remember: boolean;
}

export function decideImport(db: DB, d: ImportDecision, now = Date.now()) {
  const item = db.select().from(t.importItems).where(eq(t.importItems.id, d.itemId)).get();
  if (!item) throw ValidationError.one("itemId", "That workout is no longer in the list");
  if (d.action === "log" && (!d.skillId || !skillExists(db, d.skillId))) throw ValidationError.one("skillId", "Pick a skill");
  if (d.remember) {
    const skillId = d.action === "log" ? d.skillId! : null;
    db.insert(t.importRules)
      .values({ workoutType: typeKey(item.workoutType), action: d.action, skillId, activityTypeId: "training", createdAt: now })
      .onConflictDoUpdate({ target: t.importRules.workoutType, set: { action: d.action, skillId } })
      .run();
  }
  if (item.status === "pending") {
    if (d.action === "ignore") db.update(t.importItems).set({ status: "ignored", decidedAt: now }).where(eq(t.importItems.id, item.id)).run();
    else logItem(db, item, d.skillId!, "training", now);
  }
  return d.remember ? processPending(db, now) : null;
}

export function importRuleList(db: DB) {
  const counts = new Map<string, number>();
  for (const i of db.select().from(t.importItems).all()) counts.set(typeKey(i.workoutType), (counts.get(typeKey(i.workoutType)) ?? 0) + 1);
  return db
    .select()
    .from(t.importRules)
    .all()
    .sort((a, b) => a.workoutType.localeCompare(b.workoutType))
    .map((r) => ({ ...r, seen: counts.get(r.workoutType) ?? 0 }));
}

/** Changes what a workout type does from now on. Past imports are left as they are. */
export function setImportRule(db: DB, workoutType: string, rule: { action: "log" | "ignore"; skillId?: string | null }) {
  if (rule.action === "log" && (!rule.skillId || !skillExists(db, rule.skillId))) throw ValidationError.one("skillId", "Pick a skill");
  db.update(t.importRules)
    .set({ action: rule.action, skillId: rule.action === "log" ? rule.skillId! : null })
    .where(eq(t.importRules.workoutType, typeKey(workoutType)))
    .run();
  return processPending(db);
}

export function deleteImportRule(db: DB, workoutType: string) {
  db.delete(t.importRules).where(eq(t.importRules.workoutType, typeKey(workoutType))).run();
}

/** Undoes an imported activity and puts the workout back in review. */
export function returnToReview(db: DB, itemId: string) {
  const item = db.select().from(t.importItems).where(eq(t.importItems.id, itemId)).get();
  if (!item) throw ValidationError.one("itemId", "Not found");
  if (item.status === "imported" && item.activityId) deleteActivity(db, item.activityId);
  db.update(t.importItems).set({ status: "pending", activityId: null, decidedAt: null }).where(eq(t.importItems.id, itemId)).run();
}

export function importStats(db: DB) {
  const all = db.select().from(t.importItems).all();
  const by = (s: Item["status"]) => all.filter((i) => i.status === s).length;
  return { total: all.length, imported: by("imported"), matched: by("matched"), ignored: by("ignored"), pending: by("pending"), latest: all.reduce((m, i) => Math.max(m, i.startAt), 0) || null };
}

// ----------------------------------------------------------------- folder ---

function listJson(dir: string, depth = 0, out: string[] = [], placeholders: string[] = []): { files: string[]; placeholders: string[] } {
  if (depth > 4) return { files: out, placeholders };
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listJson(p, depth + 1, out, placeholders);
    else if (e.name.toLowerCase().endsWith(".json")) out.push(p);
    // iCloud keeps files it hasn't downloaded yet as ".name.json.icloud".
    else if (/^\..+\.json\.icloud$/i.test(e.name)) placeholders.push(p);
  }
  return { files: out, placeholders };
}

/** Asks macOS to download iCloud files that are only in the cloud. They're read on the next scan. */
function requestDownloads(placeholders: string[]) {
  if (process.platform !== "darwin") return;
  for (const p of placeholders.slice(0, 50)) {
    const real = path.join(path.dirname(p), path.basename(p).replace(/^\./, "").replace(/\.icloud$/i, ""));
    execFile("brctl", ["download", real], () => {
      /* best effort */
    });
  }
}

/** Reads one file's contents (from the folder or an upload) and ingests it. */
export function importHealthJson(db: DB, text: string, fileName: string | null, now = Date.now()) {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw ValidationError.one("file", "That file isn't valid JSON");
  }
  const workouts = parseHealthExport(json);
  return { found: workouts.length, metricsOnly: workouts.length === 0 && isMetricsOnly(json), ...ingestWorkouts(db, workouts, fileName, now) };
}

export const METRICS_ONLY_HINT =
  "These files have health metrics (steps, heart rate) but no workouts. In Health Auto Export, edit the automation and set its data type to Workouts.";

/** A Health Auto Export file of metrics, with no workouts section: the automation's data type is wrong. */
function isMetricsOnly(json: unknown): boolean {
  const data = (json as { data?: Record<string, unknown> })?.data;
  return !!data && Array.isArray(data.metrics) && !("workouts" in data);
}

/** Scans the chosen folder for new or changed export files. Safe to call often. */
export function scanHealthFolder(db: DB, now = Date.now()) {
  const folder = getSetting(db, "healthFolder");
  if (!folder) return { skipped: "No folder chosen" as const };
  const seen = { ...getSetting(db, "healthFiles") };
  let added = 0;
  let error: string | null = null;
  let waiting = 0;
  let filesRead = 0;
  let found = 0;
  let metricsOnly = 0;
  try {
    if (!fs.existsSync(folder)) throw new Error("The folder can't be found. Choose it again in Settings.");
    const { files, placeholders } = listJson(folder);
    requestDownloads(placeholders);
    for (const f of files) {
      const st = fs.statSync(f);
      if (seen[f] === st.mtimeMs || st.size > MAX_FILE_BYTES) continue;
      try {
        const r = importHealthJson(db, fs.readFileSync(f, "utf8"), path.basename(f), now);
        filesRead++;
        found += r.found;
        if (r.metricsOnly) metricsOnly++;
        added += r.added;
        waiting = r.waiting;
        seen[f] = st.mtimeMs;
      } catch (e) {
        error = `${path.basename(f)}: ${(e as Error).message}`;
        seen[f] = st.mtimeMs; // don't retry a broken file until it changes
      }
    }
    // Forget files that are gone, so the list doesn't grow forever.
    for (const k of Object.keys(seen)) if (!files.includes(k)) delete seen[k];
  } catch (e) {
    error = (e as Error).message;
  }
  setSetting(db, "healthFiles", seen);
  if (!error && filesRead && metricsOnly === filesRead) error = METRICS_ONLY_HINT;
  // Keep showing the hint until a file with workouts arrives.
  if (!error && !filesRead && getSetting(db, "healthLastScan")?.error === METRICS_ONLY_HINT) error = METRICS_ONLY_HINT;
  setSetting(db, "healthLastScan", { at: now, error, added, files: filesRead, found });
  return { added, error, waiting, files: filesRead, found };
}

/** Where Health Auto Export usually keeps its iCloud files on a Mac, if present. */
export function guessHealthFolder(): string | null {
  const home = process.env.HOME;
  if (!home) return null;
  const mobile = path.join(home, "Library", "Mobile Documents");
  try {
    for (const e of fs.readdirSync(mobile)) {
      if (/health.?export/i.test(e)) return path.join(mobile, e, "Documents");
    }
  } catch {
    /* not a Mac, or no iCloud */
  }
  return null;
}
