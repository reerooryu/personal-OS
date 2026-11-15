"use client";
import { Check } from "lucide-react";
import * as React from "react";
import { RewardProvider } from "@/components/reward/reward-provider";
import { fmt } from "@/lib/utils";
import { QuickEntry } from "./quick-entry";

declare global {
  interface Window {
    ascend?: { desktop: boolean; hideQuick: () => void };
  }
}

/** The compact bar opened by the global shortcut: type, Enter, see the result, done. */
export function QuickWindow() {
  const [done, setDone] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const hide = React.useCallback(() => window.ascend?.hideQuick(), []);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hide]);
  return (
    <RewardProvider>
      <div className="drag h-screen overflow-hidden bg-surface px-4 pt-4">
        <div className="no-drag">
          {done ? (
            <div className="flex h-11 items-center gap-2 rounded-lg border border-good/30 bg-good/10 px-3.5 text-sm text-good animate-rise">
              <Check className="size-4" /> {done}
            </div>
          ) : (
            <QuickEntry
              autoFocus
              onSaved={(r, name) => {
                const extra = [r.character.leveledUp ? `Level ${r.character.level}!` : null, ...r.questsCompleted.map((q) => `Completed ${q}`)].filter(Boolean);
                setDone(`${name}: +${fmt(r.xp)} XP${extra.length ? ` · ${extra.join(" · ")}` : ""}`);
                window.setTimeout(hide, 1800);
              }}
              onError={setError}
            />
          )}
        </div>
        <p className={error ? "mt-2 truncate text-[11px] text-bad" : "mt-2 text-[11px] text-faint"}>{error ?? "Enter to log · Esc to close"}</p>
      </div>
    </RewardProvider>
  );
}
