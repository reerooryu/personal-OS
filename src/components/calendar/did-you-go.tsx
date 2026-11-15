"use client";
/**
 * Ended tutoring, school clubs and duties from the last week. One tap logs
 * it with the right skill. Lessons never appear here.
 */
import { CalendarCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { answerCalendarAction } from "@/app/actions";
import { SkillSelect, type SkillChoice } from "@/components/imports/import-review";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";
import { dateLabel, timeLabel } from "@/lib/utils";

export interface InboxItem {
  key: string;
  title: string;
  location: string | null;
  startAt: number;
  endAt: number;
  kind: string;
  needsSkill: boolean;
  skillName: string | null;
  small: boolean;
}

function Row({ o, skills }: { o: InboxItem; skills: SkillChoice[] }) {
  const [skillId, setSkillId] = React.useState("");
  const [remember, setRemember] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const reward = useReward();
  const router = useRouter();

  async function answer(a: "went" | "missed" | "never") {
    setBusy(true);
    const r = await answerCalendarAction({ key: o.key, answer: a, skillId: o.needsSkill ? skillId : undefined, remember });
    setBusy(false);
    if (!r.ok) return reward.error(r.error);
    if (a === "went") reward.reward(r.reward, { title: o.title, activityId: r.activityId });
    else if (a === "never") reward.info(`${o.title} won't be asked about again`);
    router.refresh();
  }

  return (
    <div className="grid items-center gap-x-3 gap-y-2 border-t border-line py-3 first:border-t-0 first:pt-0 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {o.title}
          {o.skillName && <span className="font-normal text-muted"> · {o.skillName}{o.small ? " (small XP)" : ""}</span>}
        </p>
        <p className="truncate text-xs text-faint">
          {dateLabel(o.startAt)}, {timeLabel(o.startAt)}–{timeLabel(o.endAt)}
          {o.location ? ` · ${o.location}` : ""}
        </p>
        {o.needsSkill && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div className="w-52">
              <SkillSelect skills={skills} value={skillId} onChange={setSkillId} label={`Skill for ${o.title}`} />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-[var(--color-accent)]" aria-label={`Always use this skill for ${o.title}`} />
              Always for {o.title}
            </label>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || (o.needsSkill && !skillId)} onClick={() => answer("went")}>
          Went
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => answer("missed")}>
          Missed it
        </Button>
        {o.needsSkill && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => answer("never")} title="Stop asking about this club">
            Don&apos;t track
          </Button>
        )}
      </div>
    </div>
  );
}

export function DidYouGo({ items, skills, limit }: { items: InboxItem[]; skills: SkillChoice[]; limit?: number }) {
  if (!items.length) return null;
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <div>
      <p className="mb-3 flex items-center gap-2 text-sm font-medium">
        <CalendarCheck className="size-4 text-accent" />
        Did you go?
      </p>
      {shown.map((o) => (
        <Row key={o.key} o={o} skills={skills} />
      ))}
      {items.length > shown.length && <p className="pt-2 text-xs text-faint">{items.length - shown.length} more on the Calendar page.</p>}
    </div>
  );
}
