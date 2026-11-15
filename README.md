# ASCEND

A private, RPG-style personal development app. Log an activity once, and the whole system responds: XP, levels, quests, medals, achievements, the journal and analytics.

**Status: Milestone 1 of 4 (progression engine).** The engine, database, seed data and tests are complete. The full dashboard and the Mac app arrive in Milestone 2. Right now the app shows a simple overview page.

## Requirements

- macOS on Apple Silicon (the desktop app targets this; development works anywhere)
- Node.js 22 or newer (`node -v`). With nvm: `nvm install 22 && nvm use 22`

## Setup

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
| `npm run dev` | Development server |
| `npm run seed` | Seed a fresh database |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `npm test` | All tests |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run verify` | Rebuild check: recomputes every derived record and reports any difference |

## How it works

See [ARCHITECTURE.md](ARCHITECTURE.md). In short: activities, assessments and other user-entered records are **sources**. XP, quest progress, medals from quests, achievements and automatic journal entries are **derived** from them by one reconcile engine, and can always be rebuilt. The XP ledger is append-only: corrections are new entries, never edits.

## Implemented in Milestone 1

- Database schema and migrations (Drizzle + SQLite)
- XP formula with taper, difficulty and type multipliers, and formula versions
- Character, skill and attribute levels; proficiency with grades from F to S
- Activities: create, edit (with revision history), delete, undo, duplicate protection, imports keyed by external ID
- Quick logging: one-tap templates, timer, and typed entries such as `piano 30` or `tennis 1h30 hard`
- Quests: daily, weekly and long-term; durations, sessions, distinct days, assessments, milestones and sub-quests; stages; prerequisites; versioned requirements; rewards issued exactly once
- Medals (manual, or linked to quests and assessments) and data-driven achievements, including hidden ones
- Traits computed from behavior: Consistency, Discipline
- Automatic journal entries that survive your own edits
- Export, import and backup; clearing sample data
- 86 tests, including a randomized 200-operation rebuild check

## Known limitations

- No dashboard screens yet beyond the overview (Milestone 2)
- No desktop app packaging yet (Milestone 2)
- Calendar, tasks, journal and analytics screens come in Milestone 3. The Time Management trait needs tasks, so it shows "Not enough data" until then.
- Deterministic quest generation templates are not yet exposed in the UI. Two supporting quests are seeded by hand.
- No external integrations. None are pretended to exist.
