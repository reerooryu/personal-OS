"use client";
import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { QuickEntry } from "./quick-entry";

/** Press L anywhere (outside a text field) to log. */
export function QuickEntryDialog() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Quick log" description="Type what you did and press Enter.">
        <QuickEntry autoFocus onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
