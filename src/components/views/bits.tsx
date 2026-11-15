import { Award, Check, Lock } from "lucide-react";
import Link from "next/link";
import { Badge, GradeBadge, SampleBadge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn, dateLabel, fmt, minutesLabel, timeLabel } from "@/lib/utils";
import type { AttributeSummary, MedalCard, QuestCard } from "@/services/queries";
import type { ActivityListItem } from "@/services/views";

export const TIER_TONE = { gold: "gold", silver: "silver", bronze: "bronze" } as const;
const TIER_COLOR = { gold: "text-gold", silver: "text-silver", bronze: "text-bronze" } as const;

export function AttributeCard({ a }: { a: AttributeSummary }) {
  const isTraits = a.traits.length > 0;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{a.name}</h3>
        {!isTraits || a.skills.some((s) => s.xp > 0) ? <span className="text-xs text-muted">Lv {a.level.level}</span> : null}
      </div>
      <div className="mt-2">
        <Progress value={a.level.progress} color={a.color} />
      </div>
      <ul className="mt-3 space-y-1.5">
        {a.skills
          .filter((s) => !s.archived && !s.parentId)
          .map((s) => (
            <li key={s.id}>
              <Link href={`/statistics/${s.id}`} className="flex items-center justify-between gap-2 text-sm hover:text-accent">
                <span className="truncate text-ink/90">{s.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                  Lv {s.level.level}
                  <GradeBadge grade={s.grade} />
                </span>
              </Link>
            </li>
          ))}
        {a.traits.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 text-sm" title="Computed from your habits over the last 28 days">
            <span className="text-ink/90">{t.name}</span>
            <span className="flex items-center gap-2 text-xs text-muted">
              {t.score === null ? "Not enough data" : t.score}
              {t.score !== null && <GradeBadge grade={t.grade} />}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function QuestRow({ q }: { q: QuestCard }) {
  const done = q.state === "completed";
  return (
    <Link href={`/quests/${q.id}`} className="block rounded-lg px-1 py-1.5 hover:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className={cn("flex min-w-0 items-center gap-2", done && "text-muted line-through decoration-white/20")}>
          {done ? <Check className="size-4 shrink-0 text-good" /> : q.state === "locked" ? <Lock className="size-3.5 shrink-0 text-faint" /> : null}
          <span className="truncate">{q.title}</span>
          {q.isSample && <SampleBadge />}
        </span>
        <span className="shrink-0 text-xs text-muted">
          {q.requirements.length === 1 && !done ? progressText(q.requirements[0]!) : done ? `+${q.rewardXp} XP` : `${Math.round(q.progress * 100)}%`}
        </span>
      </div>
      {!done && <Progress className="mt-1.5" value={q.progress} color="var(--color-good)" />}
    </Link>
  );
}

export function progressText(r: { type: string; progress: number; target: number; met: boolean }) {
  if (r.type === "milestone") return r.met ? "Done" : "Not yet";
  if (r.type === "assessment") return r.progress > 0 ? `Best ${Math.round(r.progress)} of ${r.target}` : `Needs ${r.target}`;
  const unit = r.type === "duration" ? " min" : r.type === "sessions" ? " sessions" : r.type === "distinct_days" ? " days" : "";
  return `${Math.round(r.progress)} / ${r.target}${unit}`;
}

export function ActivityRow({ a, showDate = true }: { a: ActivityListItem; showDate?: boolean }) {
  return (
    <Link href={`/activities/${a.id}`} className="flex items-center justify-between gap-3 rounded-lg px-1 py-2 hover:bg-white/[0.03]">
      <div className="min-w-0">
        <p className="flex items-center gap-2 truncate text-sm">
          {a.name} {a.isSample && <SampleBadge />}
        </p>
        <p className="truncate text-xs text-muted">
          {showDate ? `${dateLabel(a.startAt)}, ` : ""}
          {timeLabel(a.startAt)} · {minutesLabel(a.durationMin)} · {a.skills.join(", ")}
        </p>
      </div>
      <span className="shrink-0 text-sm text-accent">+{fmt(a.xp)}</span>
    </Link>
  );
}

export function MedalRow({ m }: { m: MedalCard }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <Award className={cn("mt-0.5 size-4 shrink-0", TIER_COLOR[m.tier])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{m.occasion ?? m.name}</p>
        <p className="text-xs text-muted">
          {dateLabel(m.awardedAt)} · {fmt(m.xp)} XP {m.isSample && <SampleBadge />}
        </p>
      </div>
      <Badge tone={TIER_TONE[m.tier]} className="capitalize">
        {m.tier}
      </Badge>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}
