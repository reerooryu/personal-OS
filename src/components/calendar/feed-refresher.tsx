"use client";
import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { refreshFeedAction } from "@/app/actions";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";

/** Re-reads the school feed when the page opens if it's over 30 minutes old, and on demand. */
export function FeedRefresher({ stale, connected }: { stale: boolean; connected: boolean }) {
  const [busy, setBusy] = React.useState(false);
  const router = useRouter();
  const reward = useReward();
  const ran = React.useRef(false);

  const refresh = React.useCallback(
    async (quiet: boolean) => {
      setBusy(true);
      const r = await refreshFeedAction();
      setBusy(false);
      if (!r.ok && !quiet) reward.error(r.error);
      router.refresh();
    },
    [router, reward],
  );

  React.useEffect(() => {
    if (connected && stale && !ran.current) {
      ran.current = true;
      void refresh(true);
    }
  }, [connected, stale, refresh]);

  if (!connected) return null;
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => refresh(false)} aria-label="Refresh school calendar">
      {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} School calendar
    </Button>
  );
}
