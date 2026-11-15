"use client";
import { Info, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { markNoticesReadAction } from "@/app/actions";

export function Notices({ items }: { items: { id: number; message: string }[] }) {
  const router = useRouter();
  if (!items.length) return null;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-accent" />
      <ul className="flex-1 space-y-1 text-muted">
        {items.slice(0, 3).map((n) => (
          <li key={n.id}>{n.message}</li>
        ))}
      </ul>
      <button
        className="rounded p-1 text-faint hover:text-ink"
        aria-label="Dismiss"
        onClick={async () => {
          await markNoticesReadAction();
          router.refresh();
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
