/**
 * One-time changes to existing data, run at startup after the daily backup.
 * Each runs once: its id is recorded in settings. Schema changes belong in
 * drizzle migrations. These are for data decisions ("fold Music Theory into
 * Piano") that must also reach the database already on Ryu's Mac.
 */
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { backfillRevisionQuests } from "./schoolwork";
import { getSetting, setSetting } from "./settings";
import { mergeSkill } from "./skills";

interface Fix {
  id: string;
  run: (db: DB, now: number) => void;
}

const FIXES: Fix[] = [
  {
    // 17 Nov 2026: Ryu isn't continuing music theory. Its history (the Grade 5
    // certificate and its medal) moves under Piano, and the theory tile goes.
    id: "2026-11-fold-music-theory",
    run: (db) => {
      const has = (id: string) => !!db.select().from(t.skills).where(eq(t.skills.id, id)).get();
      if (has("music-theory") && has("piano")) mergeSkill(db, "music-theory", "piano");
      const used = db.select().from(t.activities).where(eq(t.activities.templateId, "tpl-theory")).get();
      const timer = db.select().from(t.activeTimer).where(eq(t.activeTimer.templateId, "tpl-theory")).get();
      if (!used && !timer) db.delete(t.activityTemplates).where(eq(t.activityTemplates.id, "tpl-theory")).run();
    },
  },
  {
    // 17 Nov 2026: revision quests for tests added before the feature existed.
    id: "2026-11-revision-quests",
    run: (db, now) => backfillRevisionQuests(db, now),
  },
];

/** Runs every fix not yet recorded. A failing fix is logged and retried next launch. */
export function runDataFixes(db: DB, now = Date.now()): string[] {
  const done = new Set(getSetting(db, "dataFixes"));
  const ran: string[] = [];
  for (const f of FIXES) {
    if (done.has(f.id)) continue;
    try {
      f.run(db, now);
      done.add(f.id);
      ran.push(f.id);
      setSetting(db, "dataFixes", [...done]);
    } catch (e) {
      console.error(`Data fix ${f.id} failed`, e);
    }
  }
  return ran;
}
