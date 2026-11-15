/**
 * Milestone 1 placeholder overview: shows the real seeded character so the app
 * runs end to end. The full dashboard arrives in milestone 2.
 */
import { getDb } from "@/db/client";
import { attributeSummaries, characterSummary, isSeeded, medalCase } from "@/services/queries";

export const dynamic = "force-dynamic";

const TIER = { gold: "text-amber-300", silver: "text-slate-300", bronze: "text-orange-400" } as const;

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-white/10">
      <div className="h-1.5 rounded-full" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
    </div>
  );
}

export default function Overview() {
  const db = getDb();
  if (!isSeeded(db)) {
    return (
      <main className="mx-auto max-w-xl p-10">
        <h1 className="text-2xl font-semibold">ASCEND</h1>
        <p className="mt-3 text-white/70">
          The database is empty. Run <code className="rounded bg-white/10 px-1">npm run seed</code> and reload.
        </p>
      </main>
    );
  }
  const c = characterSummary(db);
  const attributes = attributeSummaries(db);
  const medals = medalCase(db);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <p className="text-sm text-white/50">Character</p>
        <div className="mt-1 flex items-baseline justify-between">
          <h1 className="text-3xl font-semibold">{c.name}</h1>
          <p className="text-xl">Level {c.level.level}</p>
        </div>
        <div className="mt-4">
          <Bar value={c.level.progress} color="#7c9cff" />
          <p className="mt-2 text-sm text-white/60">
            {c.xp.toLocaleString("en-US")} XP · {c.level.toNext.toLocaleString("en-US")} XP to level {c.level.level + 1}
          </p>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {attributes.map((a) => (
          <div key={a.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-medium">{a.name}</h2>
              {a.traits.length === 0 && <span className="text-sm text-white/60">Lv {a.level.level}</span>}
            </div>
            {a.traits.length === 0 && (
              <div className="mt-2">
                <Bar value={a.level.progress} color={a.color} />
              </div>
            )}
            <ul className="mt-3 space-y-1 text-sm">
              {a.skills.map((s) => (
                <li key={s.id} className="flex justify-between text-white/80">
                  <span>{s.name}</span>
                  <span className="text-white/50">
                    Lv {s.level.level} · {s.grade ?? "–"}
                  </span>
                </li>
              ))}
              {a.traits.map((tr) => (
                <li key={tr.id} className="flex justify-between text-white/80">
                  <span>{tr.name}</span>
                  <span className="text-white/50">{tr.score === null ? "Not enough data" : `${tr.score} · ${tr.grade}`}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="font-medium">Medals</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {medals.map((m) => (
            <li key={m.awardId} className="flex justify-between gap-4">
              <span className="text-white/80">{m.occasion ?? m.name}</span>
              <span className={`shrink-0 capitalize ${TIER[m.tier]}`}>
                {m.tier} · {m.xp.toLocaleString("en-US")} XP
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
