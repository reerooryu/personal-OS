"use client";
/**
 * The reward moment: a card that counts up the XP, fills the bars and shows
 * what the log just moved. Bigger events (level-ups, grade-ups, medals) get a
 * short celebration. Everything shown comes from the engine's ledger.
 */
import { Award, Check, ChevronUp, Sparkles, Star, Trophy, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { track } from "@/lib/usage-client";
import { deleteActivityAction } from "@/app/actions";
import { Progress } from "@/components/ui/progress";
import { cn, fmt } from "@/lib/utils";
import type { RewardSummary } from "@/services/rewards";

interface Toast {
  id: number;
  kind: "reward" | "error" | "info";
  title?: string;
  message?: string;
  reward?: RewardSummary;
  activityId?: string;
}

interface Celebration {
  id: number;
  headline: string;
  detail: string;
  tone: "level" | "grade" | "medal" | "quest";
}

interface RewardApi {
  reward: (r: RewardSummary, opts?: { title?: string; activityId?: string }) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const Ctx = React.createContext<RewardApi | null>(null);

export function useReward(): RewardApi {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useReward must be inside RewardProvider");
  return c;
}

function CountUp({ to }: { to: number }) {
  const [v, setV] = React.useState(0);
  const [reduce] = React.useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  React.useEffect(() => {
    if (reduce) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 700);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, reduce]);
  return <>{fmt(reduce ? to : v)}</>;
}

function celebrationsFor(r: RewardSummary): Omit<Celebration, "id">[] {
  const out: Omit<Celebration, "id">[] = [];
  for (const m of r.medals) out.push({ headline: "Medal earned", detail: m, tone: "medal" });
  if (r.character.leveledUp) out.push({ headline: `Level ${r.character.level}`, detail: "Your character leveled up", tone: "level" });
  for (const g of r.gradeUps) out.push({ headline: `${g.skill}: ${g.from ? `${g.from} → ` : ""}${g.to}`, detail: "Grade up. Real improvement.", tone: "grade" });
  for (const s of r.skills.filter((x) => x.leveledUp)) out.push({ headline: `${s.name} level ${s.level}`, detail: "Skill level up", tone: "level" });
  return out.slice(0, 2);
}

function RewardCard({ t, onClose, onUndo }: { t: Toast; onClose: () => void; onUndo?: () => void }) {
  const r = t.reward!;
  const negative = r.xp < 0;
  return (
    <div className="w-[340px] rounded-xl border border-line bg-surface-2 p-4 shadow-2xl animate-rise">
      <div className="flex items-start justify-between gap-3">
        <div>
          {t.title && <p className="text-xs text-muted">{t.title}</p>}
          <p className={cn("text-2xl font-semibold", negative ? "text-muted" : "text-accent")}>
            {negative ? "−" : "+"}
            <CountUp to={Math.abs(r.xp)} /> XP
          </p>
        </div>
        <button onClick={onClose} className="rounded p-1 text-faint hover:text-ink" aria-label="Dismiss">
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-muted">
          <span>Level {r.character.level}</span>
          <span>{fmt(r.character.toNext)} XP to level {r.character.level + 1}</span>
        </div>
        <Progress value={r.character.progress} glow />
      </div>
      {r.skills.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {r.skills.slice(0, 3).map((s) => (
            <li key={s.id} className="flex justify-between gap-2">
              <span>
                {s.name} <span className="text-accent">{s.gained > 0 ? "+" : ""}{fmt(s.gained)}</span>
              </span>
              <span className="text-xs text-muted">
                {fmt(s.toNext)} XP to level {s.level + 1}
              </span>
            </li>
          ))}
        </ul>
      )}
      {r.progress.length > 0 && (
        <ul className="mt-3 space-y-2">
          {r.progress.map((p) => (
            <li key={p.title} className="text-xs">
              <div className="mb-1 flex justify-between text-muted">
                <span className="truncate">{p.title}</span>
                <span className="text-ink">{p.text}</span>
              </div>
              <Progress value={p.progress} color="var(--color-good)" />
            </li>
          ))}
        </ul>
      )}
      {(r.questsCompleted.length > 0 || r.achievements.length > 0 || r.questsReopened.length > 0) && (
        <ul className="mt-3 space-y-1 text-sm">
          {r.questsCompleted.map((q) => (
            <li key={q} className="flex items-center gap-2 text-good">
              <Check className="size-4" /> {q}
            </li>
          ))}
          {r.achievements.map((a) => (
            <li key={a} className="flex items-center gap-2 text-gold">
              <Trophy className="size-4" /> {a}
            </li>
          ))}
          {r.questsReopened.map((q) => (
            <li key={q} className="text-xs text-muted">
              Reopened: {q}
            </li>
          ))}
        </ul>
      )}
      {onUndo && (
        <div className="mt-3 flex justify-end">
          <button onClick={onUndo} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-white/[0.06] hover:text-ink">
            <Undo2 className="size-3.5" /> Undo
          </button>
        </div>
      )}
    </div>
  );
}

const TONE_ICON = { level: ChevronUp, grade: Star, medal: Award, quest: Sparkles } as const;
const TONE_COLOR = { level: "text-accent", grade: "text-good", medal: "text-gold", quest: "text-good" } as const;

export function RewardProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [celebration, setCelebration] = React.useState<Celebration | null>(null);
  const queue = React.useRef<Celebration[]>([]);
  const seq = React.useRef(0);
  const router = useRouter();

  const dismiss = React.useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);
  const push = React.useCallback(
    (t: Omit<Toast, "id">, ms = 6000) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
      window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const nextCelebration = React.useCallback(() => {
    const n = queue.current.shift() ?? null;
    setCelebration(n);
    if (n) window.setTimeout(() => setCelebration((c) => (c?.id === n.id ? null : c)), 2200);
  }, []);

  React.useEffect(() => {
    if (!celebration && queue.current.length) nextCelebration();
  }, [celebration, nextCelebration]);

  const api = React.useMemo<RewardApi>(
    () => ({
      reward: (reward, opts) => {
        push({ kind: "reward", reward, title: opts?.title, activityId: opts?.activityId }, 7000);
        for (const c of celebrationsFor(reward)) queue.current.push({ ...c, id: ++seq.current });
        if (!celebration && queue.current.length) nextCelebration();
      },
      error: (message) => {
        track("error", message);
        push({ kind: "error", message }, 7000);
      },
      info: (message) => push({ kind: "info", message }, 4000),
    }),
    [push, celebration, nextCelebration],
  );

  const undo = async (t: Toast) => {
    dismiss(t.id);
    if (!t.activityId) return;
    const r = await deleteActivityAction(t.activityId);
    if (r.ok) push({ kind: "info", message: "Undone. That log was removed." }, 3500);
    else push({ kind: "error", message: r.error });
    router.refresh();
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            {t.kind === "reward" ? (
              <RewardCard t={t} onClose={() => dismiss(t.id)} onUndo={t.activityId ? () => undo(t) : undefined} />
            ) : (
              <div
                className={cn(
                  "max-w-[340px] rounded-lg border px-4 py-3 text-sm shadow-xl animate-rise",
                  t.kind === "error" ? "border-bad/30 bg-[#2a1618] text-[#f2b8b8]" : "border-line bg-surface-2 text-ink",
                )}
              >
                {t.message}
              </div>
            )}
          </div>
        ))}
      </div>
      {celebration && (
        <button
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
          onClick={() => setCelebration(null)}
          aria-label="Dismiss celebration"
        >
          <div className="rounded-2xl border border-line bg-surface-2 px-10 py-8 text-center shadow-2xl animate-pop">
            <div className={cn("mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.06] animate-glow", TONE_COLOR[celebration.tone])}>
              {React.createElement(TONE_ICON[celebration.tone], { className: "size-7" })}
            </div>
            <p className={cn("text-2xl font-semibold", TONE_COLOR[celebration.tone])}>{celebration.headline}</p>
            <p className="mt-1 max-w-xs text-sm text-muted">{celebration.detail}</p>
          </div>
        </button>
      )}
    </Ctx.Provider>
  );
}
