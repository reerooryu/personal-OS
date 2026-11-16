"use client";
/**
 * The current-time line, like Apple Calendar: a red time label in the gutter,
 * a faint line across the week, and a solid line with a dot across today.
 * Drawn only in the browser (the server's clock isn't the viewer's), and
 * moved every 30 seconds.
 */
import * as React from "react";

const TZ = "Asia/Bangkok";

function subscribe(cb: () => void) {
  const id = window.setInterval(cb, 30_000);
  return () => window.clearInterval(id);
}

/** Changes only when the minute does, so React doesn't redraw for nothing. */
const minuteNow = () => Math.floor(Date.now() / 60_000);

export function NowLine({ days, startH, endH, pxPerMin, gutter }: { days: string[]; startH: number; endH: number; pxPerMin: number; gutter: number }) {
  const minute = React.useSyncExternalStore(subscribe, minuteNow, () => null);
  if (minute === null) return null;
  const now = new Date(minute * 60_000);
  const date = now.toLocaleDateString("en-CA", { timeZone: TZ });
  const index = days.indexOf(date);
  if (index === -1) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const mins = Number(parts.find((p) => p.type === "hour")!.value) * 60 + Number(parts.find((p) => p.type === "minute")!.value);
  if (mins < startH * 60 || mins > endH * 60) return null;
  const top = (mins - startH * 60) * pxPerMin;
  const label = now.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  const col = `(100% - ${gutter}px) / 7`;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top }} aria-label={`Now, ${label}`} role="img">
      <span className="absolute -translate-y-1/2 rounded bg-bad px-1 text-[10px] font-semibold leading-4 text-white" style={{ right: `calc(100% - ${gutter}px + 3px)` }}>
        {label.replace(/\s?[AP]M$/, "")}
      </span>
      <div className="absolute border-t border-bad/35" style={{ left: gutter, right: 0 }} />
      <div className="absolute border-t-2 border-bad" style={{ left: `calc(${gutter}px + ${col} * ${index})`, width: `calc(${col})`, top: -1 }}>
        <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-bad" />
      </div>
    </div>
  );
}
