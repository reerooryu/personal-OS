"use client";
import { ArrowLeftRight, CalendarSync } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { flipWeekAction, setBreakScopeAction, setCalendarRuleAction, setFeedUrlAction } from "@/app/actions";
import { SkillSelect, type SkillChoice } from "@/components/imports/import-review";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { dateLabel, timeLabel } from "@/lib/utils";

export interface CalendarSettingsProps {
  feedHost: string | null;
  lastFetch: { at: number; error: string | null; count: number } | null;
  week: 1 | 2 | null;
  slots: number;
  breaks: { id: string; name: string; startDate: string; endDate: string; scope: "school" | "everything" }[];
  rules: { titleKey: string; title: string; action: "log" | "ignore"; skillId: string | null; xp: "normal" | "small" }[];
  skills: SkillChoice[];
  apple: { at: number; ok: boolean; error: string | null; added: number; updated: number; removed: number; calendar: string | null } | null;
}

const noop = () => () => {};
const range = (a: string, b: string) => {
  const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return a === b ? f(a) : `${f(a)} – ${f(b)}`;
};

export function CalendarSettings({ feedHost, lastFetch, week, slots, breaks, rules, skills, apple }: CalendarSettingsProps) {
  const [url, setUrl] = React.useState("");
  const [editing, setEditing] = React.useState(!feedHost);
  const [busy, setBusy] = React.useState(false);
  const desktop = React.useSyncExternalStore(noop, () => !!window.ascend?.syncCalendar, () => false);
  const reward = useReward();
  const router = useRouter();

  async function run<T extends { ok: boolean; error?: string }>(p: Promise<T>, ok?: (r: T) => string | null) {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok) reward.error(r.error ?? "Something went wrong");
    else {
      const msg = ok?.(r);
      if (msg) reward.info(msg);
    }
    router.refresh();
    return r;
  }

  return (
    <div className="space-y-6 text-sm">
      <section className="space-y-2">
        <p className="font-medium">School calendar (SOCS)</p>
        <p className="text-muted">Clubs, music lessons and fixtures from SOCS. ASCEND reads them every 30 minutes. This link is private to Ryu: it stays on this Mac.</p>
        {editing ? (
          <div className="flex gap-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="webcal://calsync-pupil.socscms.com/…" aria-label="SOCS calendar link" />
            <Button
              variant="secondary"
              disabled={busy || !url.trim()}
              onClick={async () => {
                const r = await run(setFeedUrlAction(url), (x) => ("count" in x ? `Read ${x.count} school events` : null));
                if (r.ok) {
                  setEditing(false);
                  setUrl("");
                }
              }}
            >
              Connect
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg border border-line bg-bg px-3 py-1.5 text-xs">{feedHost}</code>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Change link
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(setFeedUrlAction(""), () => "School calendar disconnected")}>
              Disconnect
            </Button>
          </div>
        )}
        {lastFetch && (
          <p className={lastFetch.error ? "text-xs text-warn" : "text-xs text-faint"}>
            {lastFetch.error ? `Last try ${dateLabel(lastFetch.at)}, ${timeLabel(lastFetch.at)}: ${lastFetch.error}` : `Read ${lastFetch.count} events ${dateLabel(lastFetch.at)}, ${timeLabel(lastFetch.at)}.`}
          </p>
        )}
      </section>

      {rules.length > 0 && (
        <section className="space-y-2">
          <p className="font-medium">School clubs</p>
          <p className="text-muted">What each club counts as when Ryu says he went. Small XP is for things that matter but aren&apos;t practice.</p>
          <div className="divide-y divide-line rounded-lg border border-line">
            {rules.map((r) => (
              <div key={r.titleKey} className="grid grid-cols-[1fr_200px_120px] items-center gap-3 px-3 py-2">
                <span className="truncate">{r.title}</span>
                <SkillSelect
                  skills={skills}
                  includeIgnore
                  label={`Skill for ${r.titleKey}`}
                  value={r.action === "ignore" ? "__ignore" : (r.skillId ?? "")}
                  onChange={(v) => v && run(setCalendarRuleAction(r.titleKey, v === "__ignore" ? { action: "ignore" } : { action: "log", skillId: v, xp: r.xp }))}
                />
                <Select
                  value={r.xp}
                  disabled={r.action === "ignore"}
                  aria-label={`XP for ${r.titleKey}`}
                  onChange={(e) => run(setCalendarRuleAction(r.titleKey, { action: "log", skillId: r.skillId, xp: e.target.value as "normal" | "small" }))}
                >
                  <option value="normal">Normal XP</option>
                  <option value="small">Small XP</option>
                </Select>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <p className="font-medium">Timetable</p>
        {slots ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted">
              {slots} slots from the private timetable file. This week is <strong className="text-ink">Week {week}</strong>.
            </span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(flipWeekAction(), () => `This week is now Week ${week === 1 ? 2 : 1}`)}>
              <ArrowLeftRight /> Swap Week 1 and 2
            </Button>
          </div>
        ) : (
          <p className="text-muted">No timetable yet. Put it in private/timetable.json (see the README) and rebuild.</p>
        )}
      </section>

      {breaks.length > 0 && (
        <section className="space-y-2">
          <p className="font-medium">Holidays and closures</p>
          <p className="text-muted">&quot;School only&quot; pauses lessons and school duties. &quot;Everything&quot; pauses tutoring too.</p>
          <div className="divide-y divide-line rounded-lg border border-line">
            {breaks.map((b) => (
              <div key={b.id} className="grid grid-cols-[1fr_auto_150px] items-center gap-3 px-3 py-2">
                <span>{b.name}</span>
                <span className="text-xs text-faint">{range(b.startDate, b.endDate)}</span>
                <Select value={b.scope} aria-label={`What ${b.name} pauses`} onChange={(e) => run(setBreakScopeAction(b.id, e.target.value as "school" | "everything"))}>
                  <option value="school">School only</option>
                  <option value="everything">Everything</option>
                </Select>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <p className="font-medium">Apple Calendar (iPhone)</p>
        <p className="text-muted">
          The timetable, tutoring and one-off events go into a calendar called &quot;ASCEND&quot; in iCloud, so they show on the iPhone next to the SOCS events.
          ASCEND keeps the next eight weeks up to date and only touches that calendar.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {desktop ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await window.ascend!.syncCalendar!();
                setBusy(false);
                if (r.ok) reward.info(`Apple Calendar: ${r.added} added, ${r.updated} updated, ${r.removed} removed`);
                else reward.error(r.error ?? "Apple Calendar sync failed");
                router.refresh();
              }}
            >
              <CalendarSync /> Sync now
            </Button>
          ) : (
            <span className="text-xs text-faint">Works in the Mac app.</span>
          )}
          {apple && (
            <span className={apple.ok ? "text-xs text-faint" : "text-xs text-warn"}>
              {apple.ok
                ? `Last synced ${dateLabel(apple.at)}, ${timeLabel(apple.at)}${apple.calendar ? ` to "${apple.calendar}"` : ""}.`
                : `Last try ${dateLabel(apple.at)}, ${timeLabel(apple.at)}: ${apple.error}`}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
