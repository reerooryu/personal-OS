"use client";
import * as React from "react";
import { track } from "@/lib/usage-client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { QuickLogOptions } from "@/services/views";
import { QuickLog } from "./quick-log";

/** Press L anywhere (outside a text field) to log. */
export function QuickEntryDialog({ options }: { options: QuickLogOptions }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        track("open", "quick-log", { meta: { via: "L key" } });
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Quick log" description="Pick what you did, then press Log.">
        <QuickLog options={options} where="dialog" autoFocus onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
