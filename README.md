# ASCEND

A private, RPG-style personal development app. Log an activity once, and the whole system responds: XP, levels, quests, medals, achievements, the journal and analytics.

**Status: Milestone 2 of 4 (core screens and Mac app).** Overview, Statistics, Quests, Activities, Honors and Settings work, and ASCEND runs as a Mac app with a menu-bar quick log. Calendar, Journal and Analytics screens arrive in Milestone 3.

## Requirements

- macOS on Apple Silicon (the desktop app targets this; development works anywhere)
- Node.js 22 or newer (`node -v`). With nvm: `nvm install 22 && nvm use 22`

## The Mac app

```bash
npm install
npm run package
```

This builds `release/mac-arm64/ASCEND.app`. Drag it into Applications and open it. On first launch it creates its own database in `~/Library/Application Support/ASCEND`, imports `private/starting-record.json` if it was present when you packaged, and adds two weeks of sample activities (clear them in Settings).

- **Menu bar:** click the ASCEND icon for one-click logging, timers, and "Open at login".
- **Anywhere on the Mac:** press **⌥⇧L** (Option-Shift-L) for a quick log: pick from dropdowns and press Log.
- **In the app:** press **L** to log. Closing the window keeps ASCEND running in the menu bar. Quit from the menu bar or with ⌘Q.
- **Updating:** after pulling new code, run `npm install && npm run package` again and replace the app in Applications. Your data is untouched.
- A backup is written to the data folder once a day (the last 14 are kept). The server log is `server.log` in the same folder.

## Garmin workouts (Apple Health)

Garmin watch → Garmin Connect → Apple Health → Health Auto Export → iCloud Drive → ASCEND.

1. On the iPhone, in Garmin Connect: **More → Settings → Connected Apps → Apple Health**, and allow **Workouts**.
2. Install **Health Auto Export** on the iPhone. Create an automation: type **Workouts**, format **JSON**, version **2**, destination **iCloud Drive**, daily. Automatic exports need its Premium tier. Without it, use **Export** by hand and AirDrop the file to the Mac.
3. In ASCEND: **Settings → Apple Health → Choose folder**, and pick the folder the automation writes to in iCloud Drive. Or use **Import a file** for a file exported by hand.

ASCEND checks the folder every 15 minutes and when the Mac wakes. Tennis, swimming, volleyball, strength and running workouts are logged by themselves. A new type (hiking, yoga) waits on the Overview until Ryu picks a skill or ignores it, with "Always" to make it a rule. A workout that overlaps a session already logged by hand on the same skill is matched to it, not counted twice. Effort comes from average heart rate (155+ Hard, 175+ Very hard). Rules can be changed in Settings.

Strava isn't used: its API now needs a paid plan for apps like this, and its terms don't allow keeping the data.

## Usage log

ASCEND records how it's used (pages opened, buttons clicked, dropdown choices, which fields were edited, how long logging takes, forms left unfinished, errors) so the app can be made easier to use. It never records what is typed. Ryu can see a summary, export it as CSV or JSON, clear it or switch it off in **Settings → Usage log**. Events older than a year are deleted.

## Development setup

```bash
npm install
npm run seed      # creates data/ascend.db with the catalog, your starting record and sample activities
npm test          # runs all unit and integration tests
npm run dev       # then open http://localhost:3000
```

`npm run seed -- --no-sample` seeds without the sample activities.

## Your private data

The repository is public, so personal records never go into it:

- `private/starting-record.json` holds real medals and assessments from before ASCEND. The seed imports it if it exists. See `src/seed/starting-record.example.json` for the format.
- `data/` holds the database. Certificates and reports (`*.pdf`) and `evidence/` are ignored too.

All of these are in `.gitignore`. Before every commit, `git status` should show none of them.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server (browser) |
| `npm run package` | Build ASCEND.app |
| `npm run app:dev` | Run the desktop shell against the dev server (needs Electron's install script approved: `npm install-scripts approve electron && npm rebuild electron`) |
| `npm run seed` | Seed a fresh database |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `npm test` | All tests |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run verify` | Rebuild check: recomputes every derived record and reports any difference |

## How it works

See [ARCHITECTURE.md](ARCHITECTURE.md). In short: activities, assessments and other user-entered records are **sources**. XP, quest progress, medals from quests, achievements and automatic journal entries are **derived** from them by one reconcile engine, and can always be rebuilt. The XP ledger is append-only: corrections are new entries, never edits.

## Implemented in Milestone 2

- Mac app (Electron): own window, menu-bar icon with running timer and one-click logging, global quick-log shortcut (⌥⇧L), open at login, single instance, daily backups, first-launch setup
- Overview: logging tiles, "Suggested now", dropdown logger, timer, character card, today ring, attributes, active quests, recent activities, honors, week in review (Mondays), notices
- The reward moment: XP count-up, level bars, quest progress, completions, and celebrations for level-ups, grade-ups and medals, with Undo
- Activities: history by day, full log form (split skills, backdating, measured results, duplicate and long-session checks), detail page with the XP calculation, ledger, quest contributions, journal entry and edit history
- Statistics: skill tree with levels, time and grades; skill pages with assessments (and "not representative"), XP history and skill management (add, rename, move, archive, delete)
- Quests: daily, weekly, long-term, proposed and completed tabs; detail with stages, milestones to tick, what counted, history; creating quests
- Honors: medal case, awarding medals, achievements (hidden ones stay hidden)
- Settings: character name, clear sample data, verify totals, backup, export, progression settings (read-only for now)

## Added after Milestone 2

- Dropdown logger replaces typed entry everywhere (Overview, Activities, the L dialog, the ⌥⇧L window)
- Apple Health workout import for the Garmin watch, with a review list and per-type rules
- Usage log with a friction summary and CSV/JSON export
- 103 tests

## Implemented in Milestone 1

- Database schema and migrations (Drizzle + SQLite)
- XP formula with taper, difficulty and type multipliers, and formula versions
- Character, skill and attribute levels; proficiency with grades from F to S
- Activities: create, edit (with revision history), delete, undo, duplicate protection, imports keyed by external ID
- Quick logging: one-tap templates, a timer, and a dropdown logger (activity, length, difficulty, when). No typing anywhere
- Quests: daily, weekly and long-term; durations, sessions, distinct days, assessments, milestones and sub-quests; stages; prerequisites; versioned requirements; rewards issued exactly once
- Medals (manual, or linked to quests and assessments) and data-driven achievements, including hidden ones
- Traits computed from behavior: Consistency, Discipline
- Automatic journal entries that survive your own edits
- Export, import and backup; clearing sample data
- 95 tests, including a randomized 200-operation rebuild check

## Known limitations

- The Mac app isn't signed with an Apple developer certificate. Built on your own Mac it opens normally; if macOS ever blocks it, right-click it and choose Open.
- The inbox of scheduled sessions to confirm needs the calendar, so it arrives with Milestone 3.
- Progression settings, activity templates and measurement types are shown but not yet editable in the app.
- Calendar, tasks, journal and analytics screens come in Milestone 3. The Time Management trait needs tasks, so it shows "Not enough data" until then.
- Deterministic quest generation templates are not yet exposed in the UI. Two supporting quests are seeded by hand.
- Apple Health is the only integration. Google Calendar arrives with Milestone 3.
