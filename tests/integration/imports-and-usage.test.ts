import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { createActivity, deleteActivity } from "@/services/activities";
import { verify } from "@/services/engine";
import {
  decideImport,
  difficultyFromHr,
  importHealthJson,
  importRuleList,
  parseHealthDate,
  parseHealthExport,
  pendingImports,
  returnToReview,
  scanHealthFolder,
  setImportRule,
} from "@/services/health-import";
import { setSetting } from "@/services/settings";
import { clearUsage, recordUsage, usageCsv, usageSummary } from "@/services/usage";
import { NOW, seededDb, skillXp } from "./helpers";

/** Formats a time the way Health Auto Export does, in Bangkok time. */
function hae(ms: number) {
  const d = new Date(ms + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0700`;
}

function workout(name: string, startAt: number, minutes: number, extra: Record<string, unknown> = {}) {
  return { id: `hk-${Math.random().toString(36).slice(2)}`, name, start: hae(startAt), end: hae(startAt + minutes * 60_000), duration: minutes * 60, ...extra };
}

const file = (...ws: unknown[]) => JSON.stringify({ data: { workouts: ws, metrics: [] } });
const H = 3_600_000;

describe("Apple Health export parsing", () => {
  it("reads Health Auto Export dates with their offset", () => {
    expect(parseHealthDate("2024-02-06 07:00:00 -0800")).toBe(Date.parse("2024-02-06T15:00:00Z"));
    expect(parseHealthDate("2026-11-15T09:30:00+07:00")).toBe(Date.parse("2026-11-15T02:30:00Z"));
    expect(parseHealthDate("nonsense")).toBeNull();
  });

  it("reads v2 workouts with distance, energy and heart rate", () => {
    const [w] = parseHealthExport({
      data: {
        workouts: [
          workout("Pool Swim", NOW - 3 * H, 40, {
            distance: { qty: 1500, units: "m" },
            activeEnergyBurned: { qty: 1674, units: "kJ" },
            heartRate: { avg: { qty: 141.4, units: "count/min" }, max: { qty: 172, units: "count/min" } },
            source: { name: "Garmin Connect" },
            location: "Pool",
          }),
        ],
      },
    });
    expect(w).toMatchObject({ workoutType: "Pool Swim", durationMin: 40, details: { distanceKm: 1.5, kcal: 400, avgHr: 141, maxHr: 172, location: "Pool", sourceName: "Garmin Connect" } });
  });

  it("reads v1 workouts without a duration, and skips very short ones", () => {
    const v1 = { name: "Tennis", start: hae(NOW - 5 * H), end: hae(NOW - 4 * H), activeEnergy: { qty: 500, units: "kcal" } };
    const tiny = { name: "Tennis", start: hae(NOW - 2 * H), end: hae(NOW - 2 * H + 3 * 60_000) };
    const ws = parseHealthExport({ data: { workouts: [v1, tiny] } });
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({ durationMin: 60, details: { kcal: 500 } });
  });

  it("keys workouts by type and start, so a rewritten HealthKit id is the same workout", () => {
    const a = parseHealthExport({ workouts: [{ ...workout("Tennis", NOW - H, 60), id: "one" }] })[0]!;
    const b = parseHealthExport({ workouts: [{ ...workout("Tennis", NOW - H, 60), id: "two" }] })[0]!;
    expect(a.externalId).toBe(b.externalId);
  });

  it("guesses effort from average heart rate", () => {
    expect([difficultyFromHr(undefined), difficultyFromHr(100), difficultyFromHr(140), difficultyFromHr(160), difficultyFromHr(180)]).toEqual(["normal", "easy", "normal", "hard", "very_hard"]);
  });
});

describe("Apple Health import", () => {
  it("logs obvious types straight away, holds new types for review, and never imports twice", () => {
    const db = seededDb();
    const json = file(workout("Tennis", NOW - 6 * H, 60, { heartRate: { avg: { qty: 160 } } }), workout("Traditional Strength Training", NOW - 26 * H, 45), workout("Walking", NOW - 3 * H, 30));
    const r = importHealthJson(db, json, "export.json", NOW);
    expect(r).toMatchObject({ found: 3, added: 3, imported: 2, waiting: 1 });
    const tennis = db.select().from(t.activities).where(eq(t.activities.name, "Tennis")).get()!;
    expect(tennis).toMatchObject({ source: "import", durationMin: 60, difficulty: "hard" });
    expect(tennis.notes).toContain("avg HR 160");
    expect(skillXp(db, "tennis")).toBeGreaterThan(0);
    expect(skillXp(db, "gym")).toBeGreaterThan(0);
    expect(pendingImports(db).map((p) => p.workoutType)).toEqual(["Walking"]);
    expect(db.select().from(t.notices).all().at(-1)?.message).toMatch(/logged 2 workouts.*1 needs a skill/);

    const again = importHealthJson(db, json, "export.json", NOW);
    expect(again.added).toBe(0);
    expect(db.select().from(t.activities).where(eq(t.activities.source, "import")).all()).toHaveLength(2);
    expect(verify(db)).toEqual([]);
  });

  it("matches a workout to a session already logged by hand instead of counting it twice", () => {
    const db = seededDb();
    createActivity(db, { name: "Tennis", startAt: NOW - 6 * H, durationMin: 60, activityTypeId: "training", difficulty: "normal", skills: [{ skillId: "tennis", weight: 100 }] }, NOW);
    const before = skillXp(db, "tennis");
    const r = importHealthJson(db, file(workout("Tennis", NOW - 6 * H + 5 * 60_000, 55)), null, NOW);
    expect(r).toMatchObject({ imported: 0, matched: 1 });
    expect(skillXp(db, "tennis")).toBe(before);
  });

  it("review: log once, remember for next time, or ignore a type for good", () => {
    const db = seededDb();
    importHealthJson(db, file(workout("Volleyball", NOW - 30 * H, 60), workout("Hiking", NOW - 50 * H, 90), workout("Hiking", NOW - 4 * H, 60), workout("Yoga", NOW - 5 * H, 30)), null, NOW);
    // Volleyball is obvious; Hiking and Yoga wait.
    expect(skillXp(db, "volleyball")).toBeGreaterThan(0);
    const hikes = pendingImports(db).filter((p) => p.workoutType === "Hiking");
    expect(hikes).toHaveLength(2);

    decideImport(db, { itemId: hikes[0]!.id, action: "log", skillId: "track", remember: true }, NOW);
    expect(pendingImports(db).map((p) => p.workoutType)).toEqual(["Yoga"]);
    expect(importRuleList(db).find((r) => r.workoutType === "hiking")).toMatchObject({ action: "log", skillId: "track", seen: 2 });

    const yoga = pendingImports(db)[0]!;
    decideImport(db, { itemId: yoga.id, action: "ignore", remember: true }, NOW);
    importHealthJson(db, file(workout("Yoga", NOW - 2 * H, 30)), null, NOW);
    expect(pendingImports(db)).toHaveLength(0);
    expect(db.select().from(t.importItems).where(eq(t.importItems.status, "ignored")).all()).toHaveLength(2);
  });

  it("asks before logging when a rule's skill is unclear, and can change a rule later", () => {
    const db = seededDb();
    importHealthJson(db, file(workout("Cycling", NOW - 3 * H, 45)), null, NOW);
    const [c] = pendingImports(db);
    expect(c!.suggestedSkillId).toBeNull();
    expect(() => decideImport(db, { itemId: c!.id, action: "log", remember: false }, NOW)).toThrow(/Pick a skill/);
    decideImport(db, { itemId: c!.id, action: "log", skillId: "gym", remember: true }, NOW);
    setImportRule(db, "Cycling", { action: "ignore" });
    importHealthJson(db, file(workout("Cycling", NOW - 2 * H, 45)), null, NOW);
    expect(db.select().from(t.activities).where(eq(t.activities.name, "Cycling")).all()).toHaveLength(1);
  });

  it("sends an import back to review and can log it again", () => {
    const db = seededDb();
    importHealthJson(db, file(workout("Running", NOW - 3 * H, 30)), null, NOW);
    const item = db.select().from(t.importItems).get()!;
    const track = skillXp(db, "track");
    expect(track).toBeGreaterThan(0);
    returnToReview(db, item.id);
    expect(skillXp(db, "track")).toBe(0);
    decideImport(db, { itemId: item.id, action: "log", skillId: "track", remember: false }, NOW);
    expect(skillXp(db, "track")).toBe(track);
    expect(verify(db)).toEqual([]);
  });

  it("a deleted imported activity stays deleted when the same file is read again", () => {
    const db = seededDb();
    const json = file(workout("Running", NOW - 3 * H, 30));
    importHealthJson(db, json, null, NOW);
    deleteActivity(db, db.select().from(t.importItems).get()!.activityId!);
    importHealthJson(db, json, null, NOW + 60_000);
    expect(skillXp(db, "track")).toBe(0);
  });

  it("scans a folder, reading only new or changed files", () => {
    const db = seededDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ascend-health-"));
    fs.mkdirSync(path.join(dir, "Workouts"));
    fs.writeFileSync(path.join(dir, "Workouts", "a.json"), file(workout("Tennis", NOW - 5 * H, 60)));
    fs.writeFileSync(path.join(dir, "broken.json"), "{ not json");
    expect(scanHealthFolder(db, NOW)).toMatchObject({ skipped: "No folder chosen" });
    setSetting(db, "healthFolder", dir);
    const r1 = scanHealthFolder(db, NOW);
    expect(r1).toMatchObject({ added: 1 });
    expect((r1 as { error: string }).error).toMatch(/broken.json/);
    expect(scanHealthFolder(db, NOW)).toMatchObject({ added: 0 });
    fs.writeFileSync(path.join(dir, "Workouts", "b.json"), file(workout("Pool Swim", NOW - 2 * H, 40)));
    expect(scanHealthFolder(db, NOW)).toMatchObject({ added: 1 });
    // A metrics export (the automation's data type set wrong) says so instead of "nothing new".
    const only = fs.mkdtempSync(path.join(os.tmpdir(), "ascend-metrics-"));
    fs.writeFileSync(path.join(only, "HealthAutoExport-2026-46.json"), JSON.stringify({ data: { metrics: [{ name: "step_count", units: "count", data: [] }] } }));
    setSetting(db, "healthFolder", only);
    expect((scanHealthFolder(db, NOW) as { error: string }).error).toMatch(/data type to Workouts/);
    expect((scanHealthFolder(db, NOW) as { error: string }).error).toMatch(/data type to Workouts/); // still shown with no new files
    fs.rmSync(only, { recursive: true });
    setSetting(db, "healthFolder", path.join(dir, "gone"));
    expect((scanHealthFolder(db, NOW) as { error: string }).error).toMatch(/can't be found/);
    fs.rmSync(dir, { recursive: true });
  });
});

describe("usage log", () => {
  const ev = (kind: string, name: string, extra: Record<string, unknown> = {}) => ({ at: NOW - 60_000, sessionId: "s1", kind, name, path: "/", ...extra });

  it("records events and summarizes friction", () => {
    const db = seededDb();
    const n = recordUsage(
      db,
      [
        ev("view", "/", { ms: 30_000 }),
        ev("view", "/", { ms: 10_000 }),
        ev("save", "quick-log", { ms: 4000 }),
        ev("save", "quick-log", { ms: 2000 }),
        ev("save", "tile", { ms: 0 }),
        ev("abandon", "quick-log (dialog)", { ms: 8000 }),
        ev("warning", "duplicate"),
        ev("error", "Something went wrong"),
        ev("click", "x".repeat(500)),
        { kind: "bogus", name: "x" },
      ],
      NOW,
    );
    expect(n).toBe(9);
    const s = usageSummary(db, NOW);
    expect(s).toMatchObject({ events: 9, sessions: 1, logs: 3, medianLogMs: 2000, abandoned: 1, warnings: 1, errors: 1, topPages: [{ path: "/", views: 2, avgSec: 20 }] });
    expect(db.select().from(t.usageEvents).all().every((e) => e.name.length <= 80)).toBe(true);
    expect(usageCsv(db).split("\n")[0]).toBe("time,session,kind,name,path,ms,meta");
    clearUsage(db);
    expect(usageSummary(db, NOW).totalStored).toBe(0);
  });

  it("stores nothing when switched off, and drops events older than a year", () => {
    const db = seededDb();
    setSetting(db, "usageLog", false);
    expect(recordUsage(db, [ev("click", "Log")], NOW)).toBe(0);
    setSetting(db, "usageLog", true);
    db.insert(t.usageEvents).values({ at: NOW - 400 * 86_400_000, sessionId: "old", kind: "click", name: "old" }).run();
    recordUsage(db, [ev("click", "Log")], NOW);
    expect(db.select().from(t.usageEvents).all().map((e) => e.name)).toEqual(["Log"]);
  });
});
