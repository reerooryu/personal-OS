"use client";
/** ← and → change week, T jumps to this week. Ignored while typing or in a dialog. */
import { useRouter } from "next/navigation";
import * as React from "react";

export function WeekKeys({ prev, next, today }: { prev: string; next: string; today: string }) {
  const router = useRouter();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable)) return;
      if (document.querySelector("[role=dialog]")) return;
      if (e.key === "ArrowLeft") router.push(prev);
      else if (e.key === "ArrowRight") router.push(next);
      else if (e.key === "t" || e.key === "T") router.push(today);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, prev, next, today]);
  return null;
}
