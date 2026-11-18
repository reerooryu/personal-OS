/**
 * The week view: Monday to Sunday, 07:00 to 23:00, with all-day events in a
 * strip above. Lessons are quiet, tutoring and school clubs stand out,
 * cancelled sessions are struck through. Ryu's own events open the editor.
 */
import { Check, X } from "lucide-react";
import type * as React from "react";
import type { Occurrence } from "@/services/calendar";
import { AddOnDay, EditableBlock } from "./event-editor";
import { NowLine } from "./now-line";
import { EVENT_NAMES, EVENT_STYLE, KIND_NAMES, STYLE, nameOf, styleOf } from "./styles";
import { cn, timeLabel } from "@/lib/utils";

const START_H = 7;
const END_H = 23;
const PX_PER_MIN = 0.8;
const GUTTER = 52;
const TZ = "Asia/Bangkok";

function minutesOfDay(ms: number): number {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  return (
    Number(p.find((x) => x.type === "hour")!.value) * 60 +
    Number(p.find((x) => x.type === "minute")!.value)
  );
}

function dateOf(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
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

export function WeekGrid({
  days,
  items,
  today,
}: {
  days: {
    date: string;
    break: string | null;
    week: 1 | 2 | null;
    due: number;
  }[];
  items: Occurrence[];
  today: string;
}) {
  const height = (END_H - START_H) * 60 * PX_PER_MIN;
  const allDay = items.filter((o) => o.allDay);
  const label = (d: string) => {
    const dt = new Date(`${d}T12:00:00Z`);
    return {
      wd: dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      day: dt.getUTCDate(),
    };
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <div className="min-w-[860px]">
        <div className="grid grid-cols-[52px_repeat(7,1fr)]">
          <div className="border-b border-line" />
          {days.map((d) => {
            const l = label(d.date);
            return (
              <div
                key={d.date}
                className={cn(
                  "group border-b border-l border-line px-2 py-2",
                  d.date === today && "bg-accent/[0.07]",
                )}
              >
                <div className="flex items-center justify-between">
                  <p
                    className={cn(
                      "text-xs",
                      d.date === today ? "text-accent" : "text-muted",
                    )}
                  >
                    {l.wd}
                  </p>
                  <AddOnDay date={d.date} />
                </div>
                <p className="text-lg font-semibold leading-tight">{l.day}</p>
                <p className="h-4 truncate text-[11px] text-warn">
                  {d.break ??
                    (d.week ? (
                      <span className="text-faint">Week {d.week}</span>
                    ) : (
                      ""
                    ))}
                </p>
                <p className="h-4 truncate text-[11px] text-accent">
                  {d.due ? `${d.due} homework due` : ""}
                </p>
              </div>
            );
          })}
        </div>

        {allDay.length > 0 && (
          <div className="grid grid-cols-[52px_repeat(7,1fr)] border-b border-line">
            <div className="px-1 py-1.5 text-right text-[10px] leading-tight text-faint">all day</div>
            {days.map((d) => (
              <div key={d.date} className="min-h-7 space-y-1 border-l border-line p-1">
                {allDay
                  .filter((o) => coversDay(o, d.date))
                  .map((o) => (
                    <Block
                      key={o.key}
                      o={o}
                      className="block w-full truncate rounded-md border px-1.5 py-0.5 text-[11px] leading-tight"
                      tip={`${o.title}${o.location ? ` · ${o.location}` : ""}\nAll day · ${nameOf(o)}`}
                    >
                      <span className="truncate">{o.title}</span>
                    </Block>
                  ))}
              </div>
            ))}
          </div>
        )}

        <div className="relative grid grid-cols-[52px_repeat(7,1fr)]">
          <NowLine
            days={days.map((d) => d.date)}
            startH={START_H}
            endH={END_H}
            pxPerMin={PX_PER_MIN}
            gutter={GUTTER}
          />
          <div className="relative" style={{ height }}>
            {Array.from({ length: END_H - START_H }, (_, i) => (
              <span
                key={i}
                className="absolute right-2 -translate-y-1/2 text-[10px] text-faint"
                style={{ top: i * 60 * PX_PER_MIN }}
              >
                {i === 0 ? "" : `${((START_H + i) % 12) || 12} ${START_H + i < 12 ? "AM" : "PM"}`}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const dayItems = items.filter(
              (o) => !o.allDay && dateOf(o.startAt) === d.date,
            );
            const placed = lanes(dayItems);
            return (
              <div
                key={d.date}
                className={cn(
                  "relative border-l border-line",
                  d.break && "bg-white/[0.015]",
                )}
                style={{ height }}
              >
                {Array.from({ length: END_H - START_H }, (_, i) => (
                  <div
                    key={i}
                    className="absolute inset-x-0 border-t border-line/50"
                    style={{ top: i * 60 * PX_PER_MIN }}
                  />
                ))}
                {placed.map(({ o, lane, count }) => {
                  const top = Math.max(
                    0,
                    (minutesOfDay(o.startAt) - START_H * 60) * PX_PER_MIN,
                  );
                  const h = Math.max(
                    18,
                    ((o.endAt - o.startAt) / 60_000) * PX_PER_MIN - 2,
                  );
                  return (
                    <Block
                      key={o.key}
                      o={o}
                      tip={`${o.title}${o.location ? ` · ${o.location}` : ""}\n${timeLabel(o.startAt)}–${timeLabel(o.endAt)} · ${nameOf(o)}${o.cancelled ? " · cancelled" : ""}${o.mine ? "\nClick to edit" : ""}`}
                      className="absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-[11px] leading-tight"
                      style={{
                        top,
                        height: h,
                        left: `calc(${(lane / count) * 100}% + 2px)`,
                        width: `calc(${100 / count}% - 4px)`,
                      }}
                    >
                      <p className="flex items-center gap-1 truncate font-medium">
                        {o.status === "done" && (
                          <Check className="size-3 shrink-0 text-good" />
                        )}
                        {o.status === "skipped" && (
                          <X className="size-3 shrink-0" />
                        )}
                        <span className="truncate">{o.title}</span>
                      </p>
                      {h > 30 && (
                        <p className="truncate opacity-80">
                          {timeLabel(o.startAt)}
                          {o.location ? ` · ${o.location}` : ""}
                        </p>
                      )}
                    </Block>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One item on the grid: a plain box, or a button that opens the editor for Ryu's own events. */
function Block({ o, tip, className, style, children }: { o: Occurrence; tip: string; className: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const cls = cn(className, styleOf(o), o.cancelled && "line-through opacity-50", o.status === "skipped" && "opacity-40");
  if (o.mine && o.groupId)
    return (
      <EditableBlock groupId={o.groupId} title={tip} className={cls} style={style}>
        {children}
      </EditableBlock>
    );
  return (
    <div title={tip} className={cls} style={style}>
      {children}
    </div>
  );
}

/** All-day events can run over several days (a school trip from the feed). */
function coversDay(o: Occurrence, date: string) {
  return dateOf(o.startAt) <= date && dateOf(o.endAt - 1) >= date;
}

export function Legend() {
  const swatch = (k: string, cls: string, name: string) => (
    <span key={k} className="flex items-center gap-1.5">
      <span className={cn("size-3 rounded border", cls)} />
      {name}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {(Object.keys(STYLE) as Occurrence["kind"][]).map((k) => swatch(k, STYLE[k], KIND_NAMES[k]))}
      {(Object.keys(EVENT_STYLE) as (keyof typeof EVENT_STYLE)[]).map((k) => swatch(`e-${k}`, EVENT_STYLE[k], EVENT_NAMES[k]))}
    </div>
  );
}
