"use client";
import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteActivityAction, restoreActivityAction } from "@/app/actions";
import { ActivityForm, type ActivityDraft, type FormOptions } from "@/components/log/activity-form";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

export function ActivityActions({ id, deleted, options, draft }: { id: string; deleted: boolean; options: FormOptions; draft: ActivityDraft }) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const reward = useReward();
  if (deleted) {
    return (
      <Button
        variant="secondary"
        onClick={async () => {
          const r = await restoreActivityAction(id);
          if (!r.ok) return reward.error(r.error);
          reward.info("Restored. Its XP and quest progress are back.");
          router.refresh();
        }}
      >
        Restore
      </Button>
    );
  }
  return (
    <div className="flex gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="secondary">
            <Pencil /> Edit
          </Button>
        </DialogTrigger>
        <DialogContent title="Edit activity" description="XP and quest progress are corrected automatically.">
          <ActivityForm options={options} initial={draft} activityId={id} onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
      <Button
        variant="danger"
        onClick={async () => {
          if (!window.confirm("Delete this activity? Its XP and quest progress will be reversed. You can restore it from this page.")) return;
          const r = await deleteActivityAction(id);
          if (!r.ok) return reward.error(r.error);
          reward.info("Deleted. Its XP and quest progress were reversed.");
          router.refresh();
        }}
      >
        <Trash2 /> Delete
      </Button>
    </div>
  );
}
