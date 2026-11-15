"use client";
import { CornerDownLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { createActivityAction, previewEntryAction } from "@/app/actions";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";
import { DIFFICULTY_LABELS, type Difficulty } from "@/domain/types";
import { cn, newRequestId } from "@/lib/utils";
import type { ActivityInput } from "@/validation/schemas";
import type { RewardSummary } from "@/services/rewards";

type Preview = { input: ActivityInput | null; xp: number | null; problem: string | null };

/** Type a line like "piano 30" or "tennis 1h30 hard" and press Enter. */
export function QuickEntry({
  autoFocus,
  onDone,
  onSaved,
  onError,
  className,
}: {
  autoFocus?: boolean;
  onDone?: () => void;
  /** When given, results are reported here instead of as a toast (used by the compact shortcut window). */
  onSaved?: (reward: RewardSummary, name: string) => void;
  onError?: (message: string) => void;
  className?: string;
}) {
  const [text, setText] = React.useState("");
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dupWarning, setDupWarning] = React.useState<string | null>(null);
  const requestId = React.useRef(newRequestId());
  const reward = useReward();
  const router = useRouter();

  React.useEffect(() => {
    if (!text.trim()) return;
    const handle = window.setTimeout(async () => setPreview(await previewEntryAction(text)), 180);
    return () => window.clearTimeout(handle);
  }, [text]);

  async function save(confirmDuplicate = false) {
    if (!preview?.input || busy) return;
    setBusy(true);
    const r = await createActivityAction({ ...preview.input, clientRequestId: requestId.current }, { confirmDuplicate });
    setBusy(false);
    if (!r.ok) {
      if ("code" in r && r.code === "duplicate") setDupWarning(r.error);
      else if (onError) onError(r.error);
      else reward.error(r.error);
      return;
    }
    if (onSaved) onSaved(r.reward, r.name ?? "");
    else reward.reward(r.reward, { title: r.name, activityId: r.activityId });
    requestId.current = newRequestId();
    setText("");
    setPreview(null);
    setDupWarning(null);
    router.refresh();
    onDone?.();
  }

  const input = preview?.input;
  const detailsHref = input
    ? `/activities/new?${new URLSearchParams({
        name: input.name,
        duration: String(input.durationMin),
        difficulty: input.difficulty,
        type: input.activityTypeId,
        skills: JSON.stringify(input.skills),
        ...(input.notes ? { notes: input.notes } : {}),
      })}`
    : "/activities/new";

  return (
    <div className={cn("w-full", className)}>
      <div className="relative">
        <input
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDupWarning(null);
            if (!e.target.value.trim()) setPreview(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
          placeholder="Type to log: piano 30, tennis 1h30 hard, maths 45 past paper"
          className="h-11 w-full rounded-lg border border-line bg-bg pl-3.5 pr-10 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/50"
          aria-label="Quick entry"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <CornerDownLeft className="size-4" />}
        </span>
      </div>
      {(preview || dupWarning) && (
        <div className="mt-2 flex min-h-6 flex-wrap items-center justify-between gap-2 text-xs">
          {dupWarning ? (
            <span className="text-warn">
              {dupWarning}{" "}
              <button className="underline underline-offset-2" onClick={() => save(true)}>
                Save anyway
              </button>
            </span>
          ) : preview?.problem ? (
            <span className="text-muted">{preview.problem}</span>
          ) : input ? (
            <span className="text-muted">
              <span className="text-ink">{input.name}</span> · {input.durationMin} min · {DIFFICULTY_LABELS[input.difficulty as Difficulty]}
              {input.notes ? ` · "${input.notes}"` : ""} → <span className="text-accent">+{preview?.xp} XP</span>
            </span>
          ) : null}
          {input && !dupWarning && (
            <Link href={detailsHref} onClick={onDone} className="text-faint hover:text-ink">
              More details
            </Link>
          )}
        </div>
      )}
      {input && !dupWarning && (
        <Button className="sr-only" onClick={() => save()}>
          Save
        </Button>
      )}
    </div>
  );
}
