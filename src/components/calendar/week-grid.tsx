/**
 * The week view: Monday to Sunday, 07:00 to 23:00. Lessons are quiet, tutoring
 * and school clubs stand out, cancelled sessions are struck through.
 */
import { Check, X } from "lucide-react";
import type { Occurrence } from "@/services/calendar";
import { cn, timeLabel } from "@/lib/utils";

const START_H = 7;
const END_H = 23;
const PX_PER_MIN = 0.8;
const TZ = "Asia/Bangkok";

const STYLE: Record<Occurrence["kind"], string> = {
  lesson: "border-line bg-white/[0.035] text-muted",
  tutoring: "border-accent/40 bg-accent/15 text-ink",
  school: "border-good/40 bg-good/15 text-ink",
  duty: "border-warn/40 bg-warn/15 text-ink",
  event: "border-warn/50 bg-warn/20 text-ink",
  test: "border-bad/50 bg-bad/20 text-ink font-medium",
};

export const KIND_NAMES: Record<Occurrence["kind"], string> = {
  lesson: "Lesson",
  tutoring: "Tutoring",
  school: "School club (SOCS)",
  duty: "Duty",
  event: "Event",
  test: "Test",
};

function minutesOfDay(ms: number): number {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  return Number(p.find((x) => x.type === "hour")!.value) * 60 + Number(p.find((x) => x.type === "minute")!.value);
}

function dateOf(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Side-by-side lanes, only within groups of items that actually overlap. */
function lanes(items: Occurrence[]) {
  const out: { o: Occurrence; lane: number; count: number }[] = [];
  let group: { o: Occurrence; lane: number }[] = [];
  let ends: number[] = [];
  let groupEnd = -Infinity;
  const close = () => {
    for (const g of group) out.push({ ...g, count: Math.max(1, ends.length) });
    group = [];
    ends = [];
  };
  for (const o of items) {
    if (o.startAt >= groupEnd) close();
    let lane = ends.findIndex((e) => e <= o.startAt);
    if (lane === -1) lane = ends.push(0) - 1;
    ends[lane] = o.endAt;
    group.push({ o, lane });
    groupEnd = Math.max(groupEnd === -Infinity ? o.endAt : groupEnd, o.endAt);
  }
  close();
  return out;
}

export function WeekGrid({ days, items, today }: { days: { date: string; break: string | null; week: 1 | 2 | null; due: number }[]; items: Occurrence[]; today: string }) {
  const height = (END_H - START_H) * 60 * PX_PER_MIN;
  const label = (d: string) => {
    const dt = new Date(`${d}T12:00:00Z`);
    return { wd: dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }), day: dt.getUTCDate() };
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <div className="grid min-w-[860px] grid-cols-[52px_repeat(7,1fr)]">
        <div className="border-b border-line" />
        {days.map((d) => {
          const l = label(d.date);
          return (
            <div key={d.date} className={cn("border-b border-l border-line px-2 py-2", d.date === today && "bg-accent/[0.07]")}>
              <p className={cn("text-xs", d.date === today ? "text-accent" : "text-muted")}>{l.wd}</p>
              <p className="text-lg font-semibold leading-tight">{l.day}</p>
              <p className="h-4 truncate text-[11px] text-warn">{d.break ?? (d.week ? <span className="text-faint">Week {d.week}</span> : "")}</p>
              <p className="h-4 truncate text-[11px] text-accent">{d.due ? `${d.due} homework due` : ""}</p>
            </div>
          );
        })}

        <div className="relative" style={{ height }}>
          {Array.from({ length: END_H - START_H }, (_, i) => (
            <span key={i} className="absolute right-2 -translate-y-1/2 text-[10px] text-faint" style={{ top: i * 60 * PX_PER_MIN }}>
              {i === 0 ? "" : `${String(START_H + i).padStart(2, "0")}:00`}
            </span>
          ))}
        </div>
        {days.map((d) => {
          const dayItems = items.filter((o) => !o.allDay && dateOf(o.startAt) === d.date);
          const placed = lanes(dayItems);
          return (
            <div key={d.date} className={cn("relative border-l border-line", d.break && "bg-white/[0.015]")} style={{ height }}>
              {Array.from({ length: END_H - START_H }, (_, i) => (
                <div key={i} className="absolute inset-x-0 border-t border-line/50" style={{ top: i * 60 * PX_PER_MIN }} />
              ))}
              {placed.map(({ o, lane, count }) => {
                const top = Math.max(0, (minutesOfDay(o.startAt) - START_H * 60) * PX_PER_MIN);
                const h = Math.max(18, ((o.endAt - o.startAt) / 60_000) * PX_PER_MIN - 2);
                return (
                  <div
                    key={o.key}
                    title={`${o.title}${o.location ? ` · ${o.location}` : ""}\n${timeLabel(o.startAt)}–${timeLabel(o.endAt)} · ${KIND_NAMES[o.kind]}${o.cancelled ? " · cancelled" : ""}`}
                    className={cn(
                      "absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-[11px] leading-tight",
                      STYLE[o.kind],
                      o.cancelled && "line-through opacity-50",
                      o.status === "skipped" && "opacity-40",
                    )}
                    style={{ top, height: h, left: `calc(${(lane / count) * 100}% + 2px)`, width: `calc(${100 / count}% - 4px)` }}
                  >
                    <p className="flex items-center gap-1 truncate font-medium">
                      {o.status === "done" && <Check className="size-3 shrink-0 text-good" />}
                      {o.status === "skipped" && <X className="size-3 shrink-0" />}
                      <span className="truncate">{o.title}</span>
                    </p>
                    {h > 30 && (
                      <p className="truncate opacity-80">
                        {timeLabel(o.startAt)}
                        {o.location ? ` · ${o.location}` : ""}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted">
      {(Object.keys(STYLE) as Occurrence["kind"][]).map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className={cn("size-3 rounded border", STYLE[k])} />
          {KIND_NAMES[k]}
        </span>
      ))}
    </div>
  );
}
