"use client";
import { Award, BarChart3, BookOpenCheck, CalendarDays, LayoutDashboard, ListChecks, NotebookPen, Settings, Swords } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/statistics", label: "Statistics", icon: BarChart3 },
  { href: "/quests", label: "Quests", icon: Swords },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/homework", label: "Homework", icon: BookOpenCheck },
  { href: "/activities", label: "Activities", icon: ListChecks },
  { href: "/honors", label: "Honors", icon: Award },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ name, level, desktop }: { name: string; level: number; desktop: boolean }) {
  const path = usePathname();
  return (
    <aside className={cn("sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-line bg-[#0b0d11] px-3 pb-4", desktop ? "pt-11" : "pt-5")}>
      {desktop && <div className="drag absolute inset-x-0 top-0 h-10" />}
      <div className="mb-6 flex items-center gap-2 px-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/15 text-accent">
          <NotebookPen className="size-4" />
        </div>
        <span className="text-sm font-semibold tracking-[0.2em]">ASCEND</span>
      </div>
      <nav className="space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
                active ? "bg-white/[0.07] text-ink" : "text-muted hover:bg-white/[0.04] hover:text-ink",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto rounded-lg border border-line bg-surface px-3 py-2.5">
        <p className="text-xs text-muted">{name}</p>
        <p className="text-sm font-medium">Level {level}</p>
        <p className="mt-2 text-[11px] text-faint">
          Press <kbd className="rounded border border-line px-1">L</kbd> to log
        </p>
      </div>
    </aside>
  );
}
