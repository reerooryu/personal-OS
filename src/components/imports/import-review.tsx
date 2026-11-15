"use client";
/**
 * Workouts from Apple Health that need a decision: which skill they train,
 * or ignore. "Always" makes the choice a rule for that workout type.
 */
import { Watch } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { decideImportAction } from "@/app/actions";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import type { WorkoutDetails } from "@/db/schema";
import { dateLabel, minutesLabel, timeLabel } from "@/lib/utils";

export interface PendingWorkout {
  id: string;
  workoutType: string;
  startAt: number;
  durationMin: number;
  details: WorkoutDetails;
  suggestedSkillId: string | null;
}

export interface SkillChoice {
  id: string;
  name: string;
  attribute: string;
}

export function detailLine(d: WorkoutDetails): string {
  return [d.distanceKm ? `${d.distanceKm} km` : null, d.kcal ? `${d.kcal} kcal` : null, d.avgHr ? `avg HR ${d.avgHr}` : null].filter(Boolean).join(" · ");
}

export function SkillSelect({ skills, value, onChange, label, includeIgnore }: { skills: SkillChoice[]; value: string; onChange: (v: string) => void; label: string; includeIgnore?: boolean }) {
  const groups = new Map<string, SkillChoice[]>();
  for (const s of skills) groups.set(s.attribute, [...(groups.get(s.attribute) ?? []), s]);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">Pick a skill…</option>
      {includeIgnore && <option value="__ignore">Ignore</option>}
      {[...groups].map(([attr, list]) => (
        <optgroup key={attr} label={attr}>
          {list.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

function Row({ w, skills }: { w: PendingWorkout; skills: SkillChoice[] }) {
  const [skillId, setSkillId] = React.useState(w.suggestedSkillId ?? "");
  const [remember, setRemember] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const reward = useReward();
  const router = useRouter();

  async function decide(action: "log" | "ignore") {
    setBusy(true);
    const r = await decideImportAction({ itemId: w.id, action, skillId: action === "log" ? skillId : undefined, remember });
    setBusy(false);
    if (!r.ok) return reward.error(r.error);
    if (action === "log") reward.reward(r.reward, { title: w.workoutType });
    else reward.info(remember ? `${w.workoutType} workouts will be ignored` : "Ignored");
    router.refresh();
  }

  const details = detailLine(w.details);
  return (
    <div className="grid items-center gap-x-3 gap-y-2 border-t border-line py-3 first:border-t-0 first:pt-0 sm:grid-cols-[1fr_200px_auto]">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {w.workoutType} <span className="font-normal text-muted">· {minutesLabel(w.durationMin)}</span>
        </p>
        <p className="truncate text-xs text-faint">
          {dateLabel(w.startAt)}, {timeLabel(w.startAt)}
          {details ? ` · ${details}` : ""}
        </p>
        <label className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-[var(--color-accent)]" aria-label={`Always do this for ${w.workoutType}`} />
          Always do this for {w.workoutType}
        </label>
      </div>
      <SkillSelect skills={skills} value={skillId} onChange={setSkillId} label={`Skill for ${w.workoutType}`} />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !skillId} onClick={() => decide("log")}>
          Log
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide("ignore")}>
          Ignore
        </Button>
      </div>
    </div>
  );
}

export function ImportReview({ items, skills, compact }: { items: PendingWorkout[]; skills: SkillChoice[]; compact?: boolean }) {
  if (!items.length) return null;
  const shown = compact ? items.slice(0, 3) : items;
  return (
    <div>
      <p className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Watch className="size-4 text-accent" />
        {items.length} workout{items.length === 1 ? "" : "s"} from your watch need{items.length === 1 ? "s" : ""} a skill
      </p>
      {shown.map((w) => (
        <Row key={w.id} w={w} skills={skills} />
      ))}
      {compact && items.length > shown.length && <p className="pt-2 text-xs text-faint">{items.length - shown.length} more in Settings → Apple Health.</p>}
    </div>
  );
}
