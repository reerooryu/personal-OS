"use client";
/**
 * Ryu's own calendar events: competitions, formal events, study or club
 * meetups, and plans with friends. Opened from "Add event", the + on a day,
 * or by clicking one of his events on the week grid.
 */
import { CalendarPlus, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteEventAction, saveEventAction } from "@/app/actions";
import { SkillSelect, type SkillChoice } from "@/components/imports/import-review";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { toLocalDate } from "@/lib/local-time";
import { cn } from "@/lib/utils";
import { EVENT_STYLE } from "./styles";
import type { EventInput, EventKind } from "@/services/calendar";

export type EditableEvent = EventInput & { groupId: string };
type Part = { start: string; end: string; location: string };

export const EVENT_KINDS: { id: EventKind; name: string; hint: string }[] = [
  { id: "competition", name: "Competition", hint: "Logged as a competition if you pick a skill." },
  { id: "event", name: "Formal event", hint: "Prize-giving, a concert, an open day. Pick a skill only if it trains one." },
  { id: "meetup", name: "Study or club meetup", hint: "A VEX session, a study group. Pick the skill it trains." },
  { id: "friends", name: "Friends", hint: "On the calendar so the day is planned. Never counted for XP." },
];

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
/** Every 15 minutes from 5 AM to 11:45 PM. */
const TIMES = Array.from({ length: 76 }, (_, i) => 300 + i * 15);
const timeName = (m: number) => `${Math.floor(m / 60) % 12 || 12}:${pad(m % 60)} ${m < 720 ? "AM" : "PM"}`;
const addDayKey = (key: string, n: number) => new Date(Date.parse(`${key}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dayName = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const monthName = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

const Ctx = React.createContext<{ open: (p: { groupId?: string; date?: string }) => void } | null>(null);

export function EventEditor({ events, skills, children }: { events: Record<string, EditableEvent>; skills: SkillChoice[]; children: React.ReactNode }) {
  const [state, setState] = React.useState<{ editing?: EditableEvent; date?: string; n: number } | null>(null);
  const open = React.useCallback(
    (p: { groupId?: string; date?: string }) => setState((s) => ({ editing: p.groupId ? events[p.groupId] : undefined, date: p.date, n: (s?.n ?? 0) + 1 })),
    [events],
  );
  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {state && <EventDialog key={state.n} editing={state.editing} date={state.date} skills={skills} onClose={() => setState(null)} />}
    </Ctx.Provider>
  );
}

const useEditor = () => React.useContext(Ctx);

export function AddEventButton() {
  const ed = useEditor();
  return (
    <Button variant="secondary" size="sm" data-track="add event" onClick={() => ed?.open({})}>
      <CalendarPlus /> Add event
    </Button>
  );
}

export function AddOnDay({ date }: { date: string }) {
  const ed = useEditor();
  return (
    <button
      type="button"
      aria-label={`Add an event on ${dayName(date)}`}
      title="Add an event"
      data-track="add event on day"
      onClick={() => ed?.open({ date })}
      className="rounded p-0.5 text-faint opacity-0 transition hover:bg-white/[0.06] hover:text-ink focus:opacity-100 group-hover:opacity-100"
    >
      <Plus className="size-3.5" />
    </button>
  );
}

/** Wraps one of Ryu's events on the grid so clicking it opens the editor. */
export function EditableBlock({ groupId, className, style, title, children }: { groupId: string; className?: string; style?: React.CSSProperties; title?: string; children: React.ReactNode }) {
  const ed = useEditor();
  return (
    <button type="button" title={title} data-track="edit event" onClick={() => ed?.open({ groupId })} className={cn("cursor-pointer text-left hover:brightness-125", className)} style={style}>
      {children}
    </button>
  );
}

function EventDialog({ editing, date, skills, onClose }: { editing?: EditableEvent; date?: string; skills: SkillChoice[]; onClose: () => void }) {
  const [today] = React.useState(() => toLocalDate(Date.now()));
  const [kind, setKind] = React.useState<EventKind>(editing?.kind ?? "meetup");
  const [title, setTitle] = React.useState(editing?.title ?? "");
  const [day, setDay] = React.useState(editing?.date ?? date ?? today);
  const [allDay, setAllDay] = React.useState(editing?.allDay ?? false);
  const [parts, setParts] = React.useState<Part[]>(
    editing && !editing.allDay ? editing.parts.map((p) => ({ start: p.start, end: p.end, location: p.location ?? "" })) : [{ start: "15:00", end: "16:00", location: editing?.parts[0]?.location ?? "" }],
  );
  const [skillId, setSkillId] = React.useState(editing?.skillId ?? "");
  const [notes, setNotes] = React.useState(editing?.notes ?? "");
  const [busy, setBusy] = React.useState(false);
  const reward = useReward();
  const router = useRouter();

  // A year ahead, plus the event's own day if it's in the past.
  const days = Array.from({ length: 366 }, (_, i) => addDayKey(today, i));
  if (!days.includes(day)) days.unshift(day);
  const months = [...new Set(days.map(monthName))];

  const setPart = (i: number, p: Partial<Part>) =>
    setParts((ps) =>
      ps.map((x, j) => {
        if (j !== i) return x;
        const next = { ...x, ...p };
        // Moving the start keeps the length the same.
        if (p.start && !p.end) next.end = hhmm(Math.min(23 * 60 + 45, mins(p.start) + Math.max(15, mins(x.end) - mins(x.start))));
        return next;
      }),
    );
  const addPart = () =>
    setParts((ps) => {
      const last = ps[ps.length - 1]!;
      const start = mins(last.end);
      return [...ps, { start: last.end, end: hhmm(Math.min(23 * 60 + 45, start + 60)), location: "" }];
    });

  const problem = (() => {
    if (!title.trim()) return "Give it a name";
    if (allDay) return null;
    for (let i = 0; i < parts.length; i++) {
      if (mins(parts[i]!.end) <= mins(parts[i]!.start)) return "Each part must end after it starts";
      if (i && mins(parts[i]!.start) < mins(parts[i - 1]!.end)) return "Parts must be in order";
    }
    return null;
  })();

  async function save() {
    if (problem) return reward.error(problem);
    setBusy(true);
    const r = await saveEventAction(editing?.groupId ?? null, {
      title,
      kind,
      date: day,
      allDay,
      parts: allDay ? [{ start: "00:00", end: "00:00", location: parts[0]?.location || null }] : parts.map((p) => ({ ...p, location: p.location || null })),
      skillId: kind === "friends" ? null : skillId || null,
      notes: notes || null,
    });
    setBusy(false);
    if (!r.ok) return reward.error(r.error);
    reward.info(editing ? "Event updated" : `Added: ${title.trim()}`);
    onClose();
    router.refresh();
    void window.ascend?.syncCalendar?.();
  }

  const k = EVENT_KINDS.find((x) => x.id === kind)!;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={editing ? "Edit event" : "Add an event"} description="It goes on your calendar and your iPhone. Afterwards, ASCEND asks if you went." className="w-[min(600px,calc(100vw-2rem))]">
        <form
          data-track="event form"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div>
            <Label>What kind</Label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="radiogroup" aria-label="Event kind">
              {EVENT_KINDS.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="radio"
                  aria-checked={kind === x.id}
                  onClick={() => setKind(x.id)}
                  className={cn("rounded-lg border px-2 py-1.5 text-xs font-medium transition", kind === x.id ? cn(EVENT_STYLE[x.id], "ring-1 ring-white/20") : "border-line text-muted hover:text-ink")}
                >
                  {x.name}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-faint">{k.hint}</p>
          </div>
          <div>
            <Label>Name</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "competition" ? "VEX competition" : kind === "friends" ? "Dinner with friends" : "Mega VEX session"} aria-label="Event name" autoFocus />
          </div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <div>
              <Label>Day</Label>
              <Select value={day} onChange={(e) => setDay(e.target.value)} aria-label="Event day">
                {months.map((m) => (
                  <optgroup key={m} label={m}>
                    {days
                      .filter((d) => monthName(d) === m)
                      .map((d) => (
                        <option key={d} value={d}>
                          {d === today ? `Today (${dayName(d)})` : d === addDayKey(today, 1) ? `Tomorrow (${dayName(d)})` : dayName(d)}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
            </div>
            <label className="flex h-9 cursor-pointer items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-accent" aria-label="All day" />
              All day
            </label>
          </div>

          {allDay ? (
            <div>
              <Label hint="optional">Where</Label>
              <Input value={parts[0]?.location ?? ""} onChange={(e) => setPart(0, { location: e.target.value })} aria-label="Event location" />
            </div>
          ) : (
            <div className="space-y-2">
              <Label hint={parts.length > 1 ? "in order, one row per place" : "optional: add another part if it moves somewhere else"}>When and where</Label>
              {parts.map((p, i) => (
                <div key={i} className="grid grid-cols-[110px_auto_110px_1fr_auto] items-center gap-1.5">
                  <Select value={mins(p.start)} onChange={(e) => setPart(i, { start: hhmm(Number(e.target.value)) })} aria-label={`Part ${i + 1} start`}>
                    {[...new Set([...TIMES, mins(p.start)])].sort((a, b) => a - b).map((t) => (
                      <option key={t} value={t}>
                        {timeName(t)}
                      </option>
                    ))}
                  </Select>
                  <span className="text-xs text-faint">to</span>
                  <Select value={mins(p.end)} onChange={(e) => setPart(i, { end: hhmm(Number(e.target.value)) })} aria-label={`Part ${i + 1} end`}>
                    {[...new Set([...TIMES, mins(p.end)])].filter((t) => t > mins(p.start)).sort((a, b) => a - b).map((t) => (
                      <option key={t} value={t}>
                        {timeName(t)}
                      </option>
                    ))}
                  </Select>
                  <Input value={p.location} onChange={(e) => setPart(i, { location: e.target.value })} placeholder={i === 0 ? "School" : "Friend's room"} aria-label={`Part ${i + 1} location`} />
                  {parts.length > 1 ? (
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove part ${i + 1}`} onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>
                      <X />
                    </Button>
                  ) : (
                    <span className="w-9" />
                  )}
                </div>
              ))}
              {parts.length < 4 && (
                <button type="button" onClick={addPart} className="flex items-center gap-1 text-xs text-accent hover:underline" data-track="add event part">
                  <Plus className="size-3.5" /> Then somewhere else
                </button>
              )}
            </div>
          )}

          {kind !== "friends" && (
            <div>
              <Label hint="optional">Skill it trains</Label>
              <SkillSelect skills={skills} value={skillId} onChange={setSkillId} label="Event skill" />
              <p className="mt-1 text-[11px] text-faint">
                {allDay
                  ? "All-day events stay on the calendar only. For XP, give it times instead."
                  : skillId
                    ? "Afterwards, \"Did you go?\" logs it for XP."
                    : "No skill: it's on the calendar only, with no XP."}
              </p>
            </div>
          )}
          <div>
            <Label hint="optional">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Bring the battery charger" aria-label="Event notes" />
          </div>
          <div className="flex items-center justify-between pt-1">
            {editing ? (
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  if (!window.confirm(`Delete "${editing.title}"?`)) return;
                  const r = await deleteEventAction(editing.groupId);
                  if (!r.ok) return reward.error(r.error);
                  onClose();
                  router.refresh();
                  void window.ascend?.syncCalendar?.();
                }}
              >
                <Trash2 /> Delete
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={busy || !!problem}>
              {editing ? "Save" : "Add event"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
