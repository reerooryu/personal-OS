"use client";
/**
 * The dropdown logger: pick what you did, how long, how hard and when, then
 * press Log. No typing. "More details" opens the full form for anything else.
 */
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { createActivityAction, previewXpAction } from "@/app/actions";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { DIFFICULTIES, DIFFICULTY_LABELS, type Difficulty } from "@/domain/types";
import { cn, minutesLabel, newRequestId } from "@/lib/utils";
import type { RewardSummary } from "@/services/rewards";
import type { QuickLogOptions } from "@/services/views";

const MINUTES = [5, 10, 15, 20, 25, 30, 40, 45, 60, 75, 90, 120, 150, 180, 240];
const WHEN = [
  { value: 0, label: "Just finished" },
  { value: 30, label: "30 min ago" },
  { value: 60, label: "1 hour ago" },
  { value: 120, label: "2 hours ago" },
  { value: 180, label: "3 hours ago" },
];

interface Choice {
  name: string;
  durationMin: number;
  difficulty: Difficulty;
  activityTypeId: string;
  skills: { skillId: string; weight: number }[];
  templateId: string | null;
}

function resolve(options: QuickLogOptions, key: string): Choice | null {
  const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "tpl") {
    const t = options.templates.find((x) => x.id === id);
    if (!t) return null;
    return { name: t.name, durationMin: t.durationMin, difficulty: t.difficulty as Difficulty, activityTypeId: t.activityTypeId, skills: t.skills, templateId: t.id };
  }
  const s = options.skills.find((x) => x.id === id);
  if (!s) return null;
  return { name: s.name, durationMin: 30, difficulty: "normal", activityTypeId: s.activityTypeId, skills: [{ skillId: s.id, weight: 100 }], templateId: null };
}

export function QuickLog({
  options,
  compact,
  autoFocus,
  onDone,
  onSaved,
  onError,
}: {
  options: QuickLogOptions;
  /** One row without the "when" picker, for the shortcut window. */
  compact?: boolean;
  autoFocus?: boolean;
  onDone?: () => void;
  /** When given, results are reported here instead of as a toast. */
  onSaved?: (reward: RewardSummary, name: string) => void;
  onError?: (message: string) => void;
}) {
  const first = options.templates[0] ? `tpl:${options.templates[0].id}` : `skill:${options.skills[0]?.id}`;
  const [key, setKey] = React.useState(first);
  const initial = resolve(options, first);
  const [minutes, setMinutes] = React.useState(initial?.durationMin ?? 30);
  const [difficulty, setDifficulty] = React.useState<Difficulty>(initial?.difficulty ?? "normal");
  const [ago, setAgo] = React.useState(0);
  const [xp, setXp] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dup, setDup] = React.useState<string | null>(null);
  const requestId = React.useRef(newRequestId());
  const reward = useReward();
  const router = useRouter();
  const choice = resolve(options, key);

  React.useEffect(() => {
    if (!choice) return;
    let live = true;
    const h = window.setTimeout(async () => {
      const v = await previewXpAction({ durationMin: minutes, difficulty, activityTypeId: choice.activityTypeId });
      if (live) setXp(v);
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(h);
    };
  }, [choice?.activityTypeId, minutes, difficulty]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(next: string) {
    setKey(next);
    setDup(null);
    const c = resolve(options, next);
    if (c) {
      setMinutes(c.durationMin);
      setDifficulty(c.difficulty);
    }
  }

  async function save(confirmDuplicate = false) {
    if (!choice || busy) return;
    setBusy(true);
    const r = await createActivityAction(
      {
        name: choice.name,
        startAt: Date.now() - (ago + minutes) * 60_000,
        durationMin: minutes,
        activityTypeId: choice.activityTypeId,
        difficulty,
        skills: choice.skills,
        templateId: choice.templateId,
        clientRequestId: requestId.current,
      },
      { confirmDuplicate },
    );
    setBusy(false);
    if (!r.ok) {
      if ("code" in r && r.code === "duplicate") return setDup(r.error);
      if (onError) return onError(r.error);
      return reward.error(r.error);
    }
    requestId.current = newRequestId();
    setDup(null);
    if (onSaved) onSaved(r.reward, r.name ?? choice.name);
    else reward.reward(r.reward, { title: r.name, activityId: r.activityId });
    router.refresh();
    onDone?.();
  }

  const minuteOptions = MINUTES.includes(minutes) ? MINUTES : [...MINUTES, minutes].sort((a, b) => a - b);
  const detailsHref = choice
    ? `/activities/new?${new URLSearchParams({
        name: choice.name,
        duration: String(minutes),
        difficulty,
        type: choice.activityTypeId,
        skills: JSON.stringify(choice.skills),
      })}`
    : "/activities/new";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className={cn("grid gap-2", compact ? "grid-cols-[1fr_96px_112px_auto]" : "grid-cols-2 sm:grid-cols-[1fr_110px_120px_140px_auto]")}>
        <Select value={key} onChange={(e) => pick(e.target.value)} autoFocus={autoFocus} aria-label="What did you do?" className={cn(!compact && "col-span-2 sm:col-span-1")}>
          <optgroup label="Your activities">
            {options.templates.map((t) => (
              <option key={t.id} value={`tpl:${t.id}`}>
                {t.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Any skill">
            {options.skills.map((s) => (
              <option key={s.id} value={`skill:${s.id}`}>
                {s.name}
              </option>
            ))}
          </optgroup>
        </Select>
        <Select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="How long">
          {minuteOptions.map((m) => (
            <option key={m} value={m}>
              {minutesLabel(m)}
            </option>
          ))}
        </Select>
        <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)} aria-label="How hard">
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {DIFFICULTY_LABELS[d]}
            </option>
          ))}
        </Select>
        {!compact && (
          <Select value={ago} onChange={(e) => setAgo(Number(e.target.value))} aria-label="When">
            {WHEN.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </Select>
        )}
        <Button type="submit" disabled={busy || !choice} className="min-w-28">
          {busy ? <Loader2 className="animate-spin" /> : null}
          Log{xp !== null ? ` · +${xp} XP` : ""}
        </Button>
      </div>
      <div className="mt-2 flex min-h-5 items-center justify-between gap-3 text-xs">
        {dup ? (
          <span className="text-warn">
            {dup}{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => save(true)}>
              Save anyway
            </button>
          </span>
        ) : (
          <span className="text-faint">{compact ? "" : "Earlier than 3 hours ago, or split across skills? Use More details."}</span>
        )}
        {!compact && (
          <Link href={detailsHref} onClick={onDone} className="text-faint hover:text-ink">
            More details
          </Link>
        )}
      </div>
    </form>
  );
}
