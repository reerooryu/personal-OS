"use client";
import { Square, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { cancelTimerAction, stopTimerAction } from "@/app/actions";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";

export function elapsedLabel(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function TimerBar({ name, startedAt }: { name: string; startedAt: number }) {
  const [now, setNow] = React.useState(() => Date.now());
  const reward = useReward();
  const router = useRouter();
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  async function stop(confirmLong = false) {
    const r = await stopTimerAction({ confirmLong });
    if (!r.ok) {
      if ("code" in r && r.code === "confirm_long") {
        if (window.confirm("This timer ran for over 4 hours. Log it anyway? (You can edit the duration afterwards.)")) return stop(true);
        return;
      }
      return reward.error(r.error);
    }
    reward.reward(r.reward, { title: r.name, activityId: r.activityId });
    router.refresh();
  }

  async function cancel() {
    if (!window.confirm("Cancel this timer without logging it?")) return;
    await cancelTimerAction();
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-accent/30 bg-accent/[0.08] px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
        </span>
        <span className="text-sm">{name}</span>
        <span className="font-mono text-lg">{elapsedLabel(now - startedAt)}</span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={cancel} aria-label="Cancel timer">
          <X /> Cancel
        </Button>
        <Button size="sm" onClick={() => stop()}>
          <Square /> Stop and log
        </Button>
      </div>
    </div>
  );
}
