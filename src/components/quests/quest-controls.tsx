"use client";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteQuestAction, setMilestoneAction, setQuestStatusAction } from "@/app/actions";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MilestoneCheck({ requirementId, periodKey, checked, title, disabled }: { requirementId: string; periodKey: string; checked: boolean; title: string; disabled?: boolean }) {
  const router = useRouter();
  const reward = useReward();
  const [busy, setBusy] = React.useState(false);
  return (
    <button
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        const r = await setMilestoneAction(requirementId, periodKey, !checked);
        setBusy(false);
        if (!r.ok) return reward.error(r.error);
        if (!checked) reward.reward(r.reward, { title });
        router.refresh();
      }}
      className={cn("flex items-center gap-2.5 text-left text-sm disabled:opacity-50", checked ? "text-muted" : "text-ink")}
    >
      <span className={cn("flex h-5 w-5 items-center justify-center rounded-md border", checked ? "border-good bg-good/20 text-good" : "border-line")}>{checked && <Check className="size-3.5" />}</span>
      <span className={cn(checked && "line-through decoration-white/20")}>{title}</span>
    </button>
  );
}

export function QuestStatusButtons({ id, status }: { id: string; status: "proposed" | "active" | "archived" }) {
  const router = useRouter();
  const reward = useReward();
  const set = async (s: "active" | "archived") => {
    const r = await setQuestStatusAction(id, s);
    if (!r.ok) return reward.error(r.error);
    reward.info(s === "archived" ? "Archived. Its history is kept." : "Quest is active.");
    router.refresh();
  };
  return (
    <div className="flex gap-2">
      {status === "proposed" && (
        <>
          <Button onClick={() => set("active")}>Accept</Button>
          <Button
            variant="ghost"
            onClick={async () => {
              const r = await deleteQuestAction(id);
              if (!r.ok) return reward.error(r.error);
              router.push("/quests");
            }}
          >
            Dismiss
          </Button>
        </>
      )}
      {status === "active" && (
        <Button variant="secondary" onClick={() => set("archived")}>
          Archive
        </Button>
      )}
      {status === "archived" && <Button onClick={() => set("active")}>Reactivate</Button>}
    </div>
  );
}
