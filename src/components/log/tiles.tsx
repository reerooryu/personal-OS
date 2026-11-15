"use client";
import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { logTemplateAction, startTimerAction } from "@/app/actions";
import { useReward } from "@/components/reward/reward-provider";
import { track } from "@/lib/usage-client";
import { cn, newRequestId } from "@/lib/utils";

export interface TileData {
  id: string;
  name: string;
  durationMin: number;
  color: string;
}

/** One tap logs the template. The play button starts a timer instead. */
export function Tiles({ tiles, timerRunning, suggested }: { tiles: TileData[]; timerRunning: boolean; suggested?: TileData[] }) {
  const reward = useReward();
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);

  async function log(t: TileData) {
    if (pending) return;
    setPending(t.id);
    const r = await logTemplateAction(t.id, newRequestId());
    setPending(null);
    if (!r.ok) return reward.error(r.error);
    track("save", "tile", { ms: 0, meta: { template: t.id } });
    reward.reward(r.reward, { title: r.name, activityId: r.activityId });
    router.refresh();
  }

  async function start(t: TileData) {
    const r = await startTimerAction(t.id);
    if (!r.ok) return reward.error(r.error);
    reward.info(`Timer started: ${t.name}`);
    router.refresh();
  }

  const Tile = ({ t, small }: { t: TileData; small?: boolean }) => (
    <div
      className={cn(
        "group relative flex items-stretch overflow-hidden rounded-xl border border-line bg-surface-2 transition hover:border-white/20",
        pending === t.id && "opacity-60",
      )}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: t.color }} />
      <button onClick={() => log(t)} disabled={!!pending} data-track={`tile ${t.id}`} className={cn("flex-1 pl-4 pr-2 text-left", small ? "py-2" : "py-3")}>
        <p className="text-sm font-medium leading-tight">{t.name}</p>
        <p className="mt-0.5 text-xs text-muted">{t.durationMin} min</p>
      </button>
      {!timerRunning && (
        <button
          onClick={() => start(t)}
          className="flex w-9 items-center justify-center text-faint opacity-0 transition hover:bg-white/[0.06] hover:text-ink group-hover:opacity-100 focus:opacity-100"
          aria-label={`Start a timer for ${t.name}`}
          title="Start timer"
        >
          <Play className="size-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {suggested && suggested.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs text-muted">Suggested now</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {suggested.map((t) => (
              <Tile key={`s-${t.id}`} t={t} small />
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {tiles.map((t) => (
          <Tile key={t.id} t={t} />
        ))}
      </div>
    </div>
  );
}
