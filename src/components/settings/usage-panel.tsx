"use client";
import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { clearUsageAction, setUsageLogAction } from "@/app/actions";
import { useReward } from "@/components/reward/reward-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import type { usageSummary } from "@/services/usage";

type Summary = ReturnType<typeof usageSummary>;

const secs = (ms: number | null) => (ms === null ? "–" : ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);

export function UsagePanel({ s }: { s: Summary }) {
  const [busy, setBusy] = React.useState(false);
  const reward = useReward();
  const router = useRouter();
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">
        ASCEND keeps a log of how it&apos;s used: pages opened, buttons clicked, how long logging takes, forms left unfinished, and errors. It never records
        what you type. It stays on this Mac and helps make the app quicker to use.
      </p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={s.enabled}
          disabled={busy}
          aria-label="Keep a usage log"
          className="accent-[var(--color-accent)]"
          onChange={async (e) => {
            setBusy(true);
            await setUsageLogAction(e.target.checked);
            setBusy(false);
            router.refresh();
          }}
        />
        Keep a usage log
      </label>
      <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 sm:grid-cols-3">
        <Stat k="Sessions (7 days)" v={s.sessions} />
        <Stat k="Logs" v={s.logs} />
        <Stat k="Typical time to log" v={secs(s.medianLogMs)} />
        <Stat k="Left unfinished" v={s.abandoned} />
        <Stat k="Duplicate warnings" v={s.warnings} />
        <Stat k="Errors" v={s.errors} />
      </div>
      {s.topPages.length > 0 && (
        <p className="text-xs text-faint">
          Most opened: {s.topPages.map((p) => `${p.path} (${p.views}×, ~${p.avgSec} s)`).join(", ")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <a href="/api/usage/export" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          <Download /> Export CSV
        </a>
        <a href="/api/usage/export?format=json" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Export JSON
        </a>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !s.totalStored}
          onClick={async () => {
            if (!window.confirm(`Delete all ${s.totalStored} usage events?`)) return;
            setBusy(true);
            await clearUsageAction();
            setBusy(false);
            reward.info("Usage log cleared");
            router.refresh();
          }}
        >
          Clear ({s.totalStored.toLocaleString("en-US")})
        </Button>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{k}</span>
      <span>{v}</span>
    </div>
  );
}
