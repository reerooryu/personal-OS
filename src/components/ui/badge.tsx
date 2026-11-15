import * as React from "react";
import { cn } from "@/lib/utils";

const tones = {
  default: "bg-white/[0.06] text-muted border-line",
  accent: "bg-accent/15 text-accent border-accent/25",
  good: "bg-good/15 text-good border-good/25",
  warn: "bg-warn/15 text-warn border-warn/25",
  gold: "bg-gold/15 text-gold border-gold/30",
  silver: "bg-silver/10 text-silver border-silver/25",
  bronze: "bg-bronze/15 text-bronze border-bronze/30",
  sample: "bg-warn/10 text-warn border-warn/20",
} as const;

export function Badge({ tone = "default", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none", tones[tone], className)} {...props} />;
}

export function SampleBadge() {
  return <Badge tone="sample">Sample</Badge>;
}

const gradeTone: Record<string, string> = {
  S: "text-gold border-gold/40 bg-gold/10",
  A: "text-good border-good/35 bg-good/10",
  B: "text-accent border-accent/35 bg-accent/10",
  C: "text-ink border-line bg-white/[0.05]",
  D: "text-warn border-warn/30 bg-warn/10",
  E: "text-bronze border-bronze/30 bg-bronze/10",
  F: "text-muted border-line bg-white/[0.03]",
};

export function GradeBadge({ grade, size = "sm" }: { grade: string | null; size?: "sm" | "lg" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md border font-semibold",
        size === "lg" ? "h-10 w-10 text-lg" : "h-6 w-6 text-xs",
        grade ? gradeTone[grade] : "border-line text-faint",
      )}
      title={grade ? `Grade ${grade}` : "Not assessed"}
    >
      {grade ?? "–"}
    </span>
  );
}
