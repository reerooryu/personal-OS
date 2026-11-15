# ASCEND architecture

## The one rule

Every record is either a **source** (entered by the user) or **derived** (computed by the engine from sources). Derived data must always be rebuildable from sources alone. `npm run verify` proves it.

| Sources | Derived |
| --- | --- |
| Activities and their skills | XP ledger entries |
| Assessments | Proficiency (computed on read) |
| Quests, requirements, prerequisites, milestone ticks | Quest contributions and completions |
| Manual medal awards | Medal awards linked to quests or assessments |
| Achievement definitions | Achievement unlocks |
| Manual and user-edited journal entries | Automatic journal entries |
| Settings and formula versions | Levels, grades and traits (computed on read) |

## Layers

| Folder | Holds | Rules |
| --- | --- | --- |
| `src/domain` | XP, levels, time periods, proficiency, quest evaluation, traits, the quick-entry parser | Pure functions. No database, no React, no clock. |
| `src/services` | The reconcile engine and everything that writes | Owns every database transaction |
| `src/db` | Schema and connection | No business rules |
| `src/validation` | Zod schemas | Shared by forms and services |
| `src/seed` | Catalog, sample activities, starting record import | |
| `src/app` | Next.js pages | Read through `services/queries.ts`. Never compute progression. |

## The reconcile engine (`src/services/engine.ts`)

Creating, editing, deleting and restoring an activity all call one function, `reconcileAfterActivity`. Inside one transaction it:

1. Computes the activity's expected XP (character plus skill shares) and posts only the **difference** from what the ledger already holds.
2. Re-evaluates every quest for the periods the activity touches (before and after an edit), replacing contributions and adding or removing the completion and its reward.
3. Follows dependent quests (prerequisites and sub-quests) until nothing changes.
4. Reconciles linked medals, all medal XP, and achievements.
5. Refreshes automatic journal entries for every activity whose story changed.

Because it writes differences, running it twice writes nothing. Database unique constraints back this up:

- XP entry: unique on (source type, source id, target, sequence)
- Quest contribution: unique on (activity, requirement, period)
- Quest completion: unique on (quest, period)
- Medal award: unique on (medal, occasion)
- Activity: unique client request id, and unique (source, external id)

`reconcileAll` recomputes everything. `verify` runs it in a transaction that is always rolled back and returns what it would have changed. An empty list means every derived record matches its sources. The randomized test runs 200 mixed operations and then requires an empty list.

## XP and levels

```
XP = round(B × E(D) × difficulty × type)
E(D) = min(D, 90) + 0.5 × max(0, D − 90)
next level = round(base × L^1.5)   character base 100, skill base 50
```

Each activity stores the formula version it was scored with. Saving new settings creates a new version for new activities only. "Recalculate all" is an explicit action with a preview.

XP for an activity goes to the character once, and is split across its skills with largest-remainder rounding, so the shares always add up exactly. Parent skills and attributes show the sum of their children, computed on read, so nothing is counted twice.

## Quests

Daily and weekly quests produce one instance per period (`2026-11-15`, `2026-W46`). Long-term quests have one instance, `once`. Days start at 04:00 Bangkok time, and weeks start on Monday.

`evaluateQuest` (pure) walks the period's events in time order. Each stage only counts events from the moment the previous stage completed. A duration requirement counts an activity's minutes times its matching skill weight, so one hour split between two skills is never counted as two hours.

Changing requirements creates a new requirement version. Recurring quests use it from the current period on, so past periods keep the rules they ran under.

## Time

All timestamps are UTC milliseconds. `src/domain/time.ts` is the only place that converts to local days and weeks.

## The desktop app (`electron/`)

`electron/main.cjs` starts the bundled Next.js standalone server with Electron's `utilityProcess` on a random free port bound to 127.0.0.1, waits for `/api/health`, and loads it in a window. It sets:

- `ASCEND_DATA_DIR` to `~/Library/Application Support/ASCEND`
- `ASCEND_MIGRATIONS_DIR` to the bundled `drizzle/` folder
- `ASCEND_STARTING_RECORD` to the bundled starting record, if one was packaged
- `ASCEND_DESKTOP=1`, which turns on first-launch seeding and daily backups (`src/services/bootstrap.ts`)

The menu-bar icon talks to `/api/tray`. The global shortcut opens a small window on `/quick`. `better-sqlite3` uses Node-API prebuilt binaries, so the same binary works in Node and in Electron with no rebuild.

`npm run package` (`scripts/package-app.mjs`) builds the standalone server, copies it with its static files, migrations and the optional starting record into `dist-app/`, runs electron-builder (the app archive holds only `electron/`), copies `dist-app/` into the app's Resources in an `afterPack` hook, and ad-hoc signs the app for this Mac.

## Data location

Development uses `./data/ascend.db`. The desktop app uses `~/Library/Application Support/ASCEND`. They are separate databases.
