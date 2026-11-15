"use client";
import { useRouter } from "next/navigation";
import * as React from "react";
import { backupNowAction, clearSampleDataAction, renameCharacterAction, verifyAction } from "@/app/actions";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CharacterName({ name }: { name: string }) {
  const [v, setV] = React.useState(name);
  const router = useRouter();
  const reward = useReward();
  return (
    <div className="flex gap-2">
      <Input value={v} onChange={(e) => setV(e.target.value)} className="max-w-xs" />
      <Button
        variant="secondary"
        disabled={v === name}
        onClick={async () => {
          const r = await renameCharacterAction(v);
          if (!r.ok) return reward.error(r.error);
          reward.info("Saved");
          router.refresh();
        }}
      >
        Save
      </Button>
    </div>
  );
}

export function DataTools({ samples }: { samples: number }) {
  const [verifyResult, setVerifyResult] = React.useState<string[] | null>(null);
  const [backup, setBackup] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const router = useRouter();
  const reward = useReward();
  return (
    <div className="space-y-4 text-sm">
      <Row title="Clear sample data" text={samples ? `Removes the ${samples} sample activities. A backup is made first.` : "No sample data left."}>
        <Button
          variant="danger"
          disabled={!samples || busy !== null}
          onClick={async () => {
            if (!window.confirm("Remove all sample data? Your real records stay. A backup is made first.")) return;
            setBusy("clear");
            const r = await clearSampleDataAction();
            setBusy(null);
            if (!r.ok) return reward.error(r.error);
            reward.info("Sample data cleared");
            router.refresh();
          }}
        >
          Clear
        </Button>
      </Row>
      <Row
        title="Verify totals"
        text={
          verifyResult === null
            ? "Recomputes every XP total, quest and medal from your records and checks they match."
            : verifyResult.length === 0
              ? "All totals verified. Every derived record matches its sources."
              : `${verifyResult.length} difference(s) found: ${verifyResult.slice(0, 3).join("; ")}`
        }
      >
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={async () => {
            setBusy("verify");
            const r = await verifyAction();
            setBusy(null);
            if (r.ok) setVerifyResult(r.differences);
          }}
        >
          Verify
        </Button>
      </Row>
      <Row title="Back up now" text={backup ? `Saved to ${backup}` : "The desktop app also makes one automatic backup a day and keeps 14."}>
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={async () => {
            setBusy("backup");
            const r = await backupNowAction();
            setBusy(null);
            if (!r.ok) return reward.error(r.error);
            setBackup(r.file);
          }}
        >
          Back up
        </Button>
      </Row>
      <Row title="Export everything" text="One JSON file with all your records. Import it into a fresh ASCEND to restore.">
        <a href="/api/export" className="inline-flex h-9 items-center rounded-lg border border-line bg-surface-2 px-4 text-sm font-medium hover:bg-white/[0.07]">
          Export
        </a>
      </Row>
    </div>
  );
}

function Row({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-muted">{text}</p>
      </div>
      {children}
    </div>
  );
}
