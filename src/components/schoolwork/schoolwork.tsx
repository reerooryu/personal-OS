"use client";
/**
 * Homework and tests: add/edit dialogs with a "next lesson" due-date picker,
 * the tick-off checklist row, and the test row with its result entry.
 */
import { Check, ClipboardList, GraduationCap, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  completeHomeworkAction,
  deleteHomeworkAction,
  deleteTestAction,
  noTestResultAction,
  recordTestResultAction,
  reopenHomeworkAction,
  saveHomeworkAction,
  saveTestAction,
} from "@/app/actions";
import { SkillSelect, type SkillChoice } from "@/components/imports/import-review";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { fromLocalInput, toLocalDate, toLocalInput } from "@/lib/local-time";
import { cn, dateLabel, minutesLabel, timeLabel } from "@/lib/utils";

export type LessonChoices = Record<string, { startAt: number; endAt: number; location: string | null; week: 1 | 2 | null }[]>;

export interface HomeworkItem {
  id: string;
  title: string;
  skillId: string;
  skillName: string;
  dueAt: number;
  description: string | null;
  completedAt: number | null;
  activityId: string | null;
}

export interface TestItem {
  id: string;
  title: string;
  kind: "quiz" | "test" | "mock" | "exam";
  skillId: string;
  skillName: string;
  startAt: number;
  durationMin: number;
  notes: string | null;
  assessmentId: string | null;
  noResult: boolean;
  hasResultType: boolean;
  revision?: {
    questId: string;
    state: string;
    reason: string | null;
    minutes: { done: number; target: number };
    days: { done: number; target: number } | null;
  } | null;
}

const KINDS = { quiz: "Quiz", test: "Test", mock: "Mock exam", exam: "Exam" } as const;

/** "today, 10:05 AM", "tomorrow, 4:00 PM", "Wed, Nov 18, 7:50 AM" */
export function whenLabel(ms: number, now: number) {
  const day = (x: number) => new Date(x).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const d = Math.round((Date.parse(day(ms)) - Date.parse(day(now))) / 86_400_000);
  const prefix = d === 0 ? "today" : d === 1 ? "tomorrow" : d === -1 ? "yesterday" : dateLabel(ms);
  return `${prefix}, ${timeLabel(ms)}`;
}

export function countdown(ms: number, now: number) {
  const day = (x: number) => new Date(x).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const d = Math.round((Date.parse(day(ms)) - Date.parse(day(now))) / 86_400_000);
  if (ms < now) return "done";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  return `in ${d} days`;
}

// ------------------------------------------------------------ due picker ---

const CUSTOM = "custom";
const DAY = 86_400_000;

/** Times offered for "another day or time": every half hour, the school's period times, and end of day. */
const TIMES = [
  ...new Set([
    ...Array.from({ length: 36 }, (_, i) => 360 + i * 30),
    ...[470, 530, 585, 605, 660, 665, 720, 770, 825, 830, 885, 900, 955].values(),
    1439,
  ]),
].sort((a, b) => a - b);

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const timeName = (m: number) => {
  const h = Math.floor(m / 60);
  const label = `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  return m === 1439 ? `${label} (end of day)` : label;
};
const dayName = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const addDayKey = (key: string, n: number) => new Date(Date.parse(`${key}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const mondayKey = (key: string) => addDayKey(key, -((new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7));

/** "This week", "Next week", "Week of Nov 30", for grouping long lists. */
function weekGroup(key: string, todayKey: string) {
  const diff = Math.round((Date.parse(mondayKey(key)) - Date.parse(mondayKey(todayKey))) / (7 * DAY));
  return diff === 0 ? "This week" : diff === 1 ? "Next week" : `Week of ${dayName(mondayKey(key)).replace(/^\w+, /, "")}`;
}

/**
 * Due-date picker without typing: the subject's lessons for six weeks, grouped
 * by week, or another day and time from two dropdowns.
 */
function DuePicker({
  lessons,
  value,
  onChange,
  label,
}: {
  lessons: LessonChoices[string];
  value: { at: number; lessonEnd?: number } | null;
  onChange: (v: { at: number; lessonEnd?: number } | null) => void;
  label: string;
}) {
  const match = value ? lessons.find((l) => l.startAt === value.at) : undefined;
  const [custom, setCustom] = React.useState(!!value && !match);
  const [today] = React.useState(() => toLocalDate(Date.now()));
  const selectValue = custom ? CUSTOM : match ? String(match.startAt) : "";

  const groups = new Map<string, LessonChoices[string]>();
  for (const l of lessons) {
    const g = `${weekGroup(toLocalDate(l.startAt), today)}${l.week ? ` · Week ${l.week}` : ""}`;
    groups.set(g, [...(groups.get(g) ?? []), l]);
  }

  // Custom day and time, from the current value or tomorrow at 4 PM.
  const current = value && !match ? toLocalInput(value.at) : null;
  const dayValue = current?.slice(0, 10) ?? addDayKey(today, 1);
  const [h, m] = (current?.slice(11, 16) ?? "16:00").split(":").map(Number);
  const timeValue = h! * 60 + m!;
  const days = Array.from({ length: 70 }, (_, i) => addDayKey(today, i));
  const setCustomValue = (day: string, minutes: number) => onChange({ at: fromLocalInput(`${day}T${hhmm(minutes)}`) });

  return (
    <div className="space-y-2">
      <Select
        value={selectValue}
        aria-label={label}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            setCustomValue(dayValue, timeValue);
            return;
          }
          setCustom(false);
          const l = lessons.find((x) => String(x.startAt) === e.target.value);
          onChange(l ? { at: l.startAt, lessonEnd: l.endAt } : null);
        }}
      >
        {!lessons.length && <option value="">No lessons in the next six weeks</option>}
        {[...groups].map(([g, ls]) => (
          <optgroup key={g} label={g}>
            {ls.map((l) => (
              <option key={l.startAt} value={l.startAt}>
                Lesson: {dateLabel(l.startAt)}, {timeLabel(l.startAt)}
                {l.location ? ` · ${l.location}` : ""}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={CUSTOM}>Another day or time…</option>
      </Select>
      {custom && (
        <div className="grid grid-cols-[1fr_170px] gap-2">
          <Select value={dayValue} onChange={(e) => setCustomValue(e.target.value, timeValue)} aria-label={`${label}: day`}>
            {[...new Set(days.map((d) => weekGroup(d, today)))].map((g) => (
              <optgroup key={g} label={g}>
                {days
                  .filter((d) => weekGroup(d, today) === g)
                  .map((d) => (
                    <option key={d} value={d}>
                      {d === today ? `Today (${dayName(d)})` : d === addDayKey(today, 1) ? `Tomorrow (${dayName(d)})` : dayName(d)}
                    </option>
                  ))}
              </optgroup>
            ))}
            {!days.includes(dayValue) && <option value={dayValue}>{dayName(dayValue)}</option>}
          </Select>
          <Select value={timeValue} onChange={(e) => setCustomValue(dayValue, Number(e.target.value))} aria-label={`${label}: time`}>
            {[...new Set([...TIMES, timeValue])]
              .sort((a, b) => a - b)
              .map((t) => (
                <option key={t} value={t}>
                  {timeName(t)}
                </option>
              ))}
          </Select>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- dialogs ---

export function HomeworkDialog({
  skills,
  lessons,
  editing,
  trigger,
}: {
  skills: SkillChoice[];
  lessons: LessonChoices;
  editing?: HomeworkItem;
  trigger: (open: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [skillId, setSkillId] = React.useState("");
  const [due, setDue] = React.useState<{ at: number } | null>(null);
  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const reward = useReward();
  const router = useRouter();

  function start() {
    setTitle(editing?.title ?? "");
    setSkillId(editing?.skillId ?? "");
    setDue(editing ? { at: editing.dueAt } : null);
    setDescription(editing?.description ?? "");
    setOpen(true);
  }

  function pickSubject(id: string) {
    setSkillId(id);
    const next = lessons[id]?.[0];
    if (!editing || !due) setDue(next ? { at: next.startAt } : null);
  }

  async function save() {
    if (!due) return reward.error("Pick when it's due");
    setBusy(true);
    const r = await saveHomeworkAction(editing?.id ?? null, { title, skillId, dueAt: due.at, description });
    setBusy(false);
    if (!r.ok) return reward.error(r.error);
    reward.info(editing ? "Homework updated" : `Added: ${title}`);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      {trigger(start)}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={editing ? "Edit homework" : "Add homework"} description="Pick the subject, then when it's due: the next lesson is already selected.">
          <form
            data-track="homework form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div>
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Math Worksheet" aria-label="Homework title" autoFocus />
            </div>
            <div>
              <Label>Subject</Label>
              <SkillSelect skills={skills} value={skillId} onChange={pickSubject} label="Homework subject" />
            </div>
            <div>
              <Label>Due</Label>
              <DuePicker key={skillId} lessons={lessons[skillId] ?? []} value={due} onChange={setDue} label="Homework due" />
            </div>
            <div>
              <Label hint="optional">Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Mark using the mark scheme" aria-label="Homework description" />
            </div>
            <div className="flex items-center justify-between pt-1">
              {editing ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={async () => {
                    if (!window.confirm(`Delete "${editing.title}"?`)) return;
                    await deleteHomeworkAction(editing.id);
                    setOpen(false);
                    router.refresh();
                  }}
                >
                  <Trash2 /> Delete
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={busy || !title.trim() || !skillId || !due}>
                {editing ? "Save" : "Add homework"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TestDialog({
  skills,
  lessons,
  editing,
  trigger,
}: {
  skills: SkillChoice[];
  lessons: LessonChoices;
  editing?: TestItem;
  trigger: (open: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [skillId, setSkillId] = React.useState("");
  const [kind, setKind] = React.useState<TestItem["kind"]>("test");
  const [when, setWhen] = React.useState<{ at: number; lessonEnd?: number } | null>(null);
  const [durationMin, setDuration] = React.useState(55);
  const [title, setTitle] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const reward = useReward();
  const router = useRouter();

  function start() {
    setSkillId(editing?.skillId ?? "");
    setKind(editing?.kind ?? "test");
    setWhen(editing ? { at: editing.startAt } : null);
    setDuration(editing?.durationMin ?? 55);
    setTitle(editing?.title ?? "");
    setNotes(editing?.notes ?? "");
    setOpen(true);
  }

  function pickWhen(v: { at: number; lessonEnd?: number } | null) {
    setWhen(v);
    // A test in a lesson lasts the lesson, doubles included.
    if (v?.lessonEnd) setDuration(Math.round((v.lessonEnd - v.at) / 60_000));
  }

  async function save() {
    if (!when) return reward.error("Pick when it is");
    setBusy(true);
    const r = await saveTestAction(editing?.id ?? null, { skillId, kind, startAt: when.at, durationMin, title: title.trim() || null, notes });
    setBusy(false);
    if (!r.ok) return reward.error(r.error);
    reward.info(editing ? "Test updated" : "Test added");
    setOpen(false);
    router.refresh();
  }

  const subjectName = skills.find((s) => s.id === skillId)?.name;
  return (
    <>
      {trigger(start)}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={editing ? "Edit test" : "Add a test"} description="Tests show on the calendar in place of the lesson, with a countdown on the Overview.">
          <form
            data-track="test form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="grid grid-cols-[1fr_140px] gap-2">
              <div>
                <Label>Subject</Label>
                <SkillSelect
                  skills={skills}
                  value={skillId}
                  label="Test subject"
                  onChange={(id) => {
                    setSkillId(id);
                    const next = lessons[id]?.[0];
                    pickWhen(next ? { at: next.startAt, lessonEnd: next.endAt } : null);
                  }}
                />
              </div>
              <div>
                <Label>Kind</Label>
                <Select value={kind} onChange={(e) => setKind(e.target.value as TestItem["kind"])} aria-label="Kind of test">
                  {Object.entries(KINDS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label>When</Label>
              <DuePicker key={skillId} lessons={lessons[skillId] ?? []} value={when} onChange={pickWhen} label="Test date" />
            </div>
            <div className="grid grid-cols-[1fr_140px] gap-2">
              <div>
                <Label hint="optional">Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={subjectName ? `${subjectName} ${KINDS[kind].toLowerCase()}` : "Title"} aria-label="Test title" />
              </div>
              <div>
                <Label>Length</Label>
                <Select value={durationMin} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Test length">
                  {[...new Set([20, 30, 45, 55, 60, 90, 115, 120, 150, 180, durationMin])]
                    .sort((a, b) => a - b)
                    .map((m) => (
                      <option key={m} value={m}>
                        {minutesLabel(m)}
                      </option>
                    ))}
                </Select>
              </div>
            </div>
            <div>
              <Label hint="optional">Topics</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Chapters, topics, what to revise" aria-label="Test topics" />
            </div>
            <div className="flex items-center justify-between pt-1">
              {editing ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={async () => {
                    if (!window.confirm(`Delete "${editing.title}"?`)) return;
                    await deleteTestAction(editing.id);
                    setOpen(false);
                    router.refresh();
                  }}
                >
                  <Trash2 /> Delete
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={busy || !skillId || !when}>
                {editing ? "Save" : "Add test"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AddButtons({ skills, lessons }: { skills: SkillChoice[]; lessons: LessonChoices }) {
  return (
    <div className="flex gap-2">
      <HomeworkDialog
        skills={skills}
        lessons={lessons}
        trigger={(open) => (
          <Button onClick={open}>
            <Plus /> Homework
          </Button>
        )}
      />
      <TestDialog
        skills={skills}
        lessons={lessons}
        trigger={(open) => (
          <Button variant="secondary" onClick={open}>
            <GraduationCap /> Test
          </Button>
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------- checklist row ---

const MINUTES = [15, 30, 45, 60, 90, 120];

export function HomeworkRow({ h, now, skills, lessons, compact }: { h: HomeworkItem; now: number; skills: SkillChoice[]; lessons: LessonChoices; compact?: boolean }) {
  const [asking, setAsking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const reward = useReward();
  const router = useRouter();
  const done = !!h.completedAt;
  const overdue = !done && h.dueAt < now;

  async function complete(minutes: number | null) {
    setBusy(true);
    const r = await completeHomeworkAction(h.id, minutes);
    setBusy(false);
    setAsking(false);
    if (!r.ok) return reward.error(r.error);
    if (minutes) reward.reward(r.reward, { title: h.title, activityId: r.activityId });
    else reward.info(`Done: ${h.title}`);
    router.refresh();
  }

  async function reopen() {
    const remove = h.activityId ? window.confirm("Also remove the study time logged when you ticked it?") : false;
    setBusy(true);
    const r = await reopenHomeworkAction(h.id, remove);
    setBusy(false);
    if (!r.ok) return reward.error(r.error);
    router.refresh();
  }

  return (
    <div className={cn("rounded-lg border px-2.5 py-2", overdue ? "border-bad/40 bg-bad/[0.06]" : "border-line bg-surface-2", done && "opacity-60")}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => (done ? reopen() : setAsking((a) => !a))}
          aria-label={done ? `Mark ${h.title} as not done` : `Tick off ${h.title}`}
          className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border", done ? "border-good bg-good text-bg" : "border-white/30 hover:border-accent")}
        >
          {done && <Check className="size-3" />}
        </button>
        <HomeworkDialog
          skills={skills}
          lessons={lessons}
          editing={h}
          trigger={(open) => (
            <button type="button" onClick={open} className="min-w-0 flex-1 text-left" aria-label={`Edit ${h.title}`}>
              <p className={cn("text-sm leading-tight", done && "line-through")}>{h.title}</p>
              <p className={cn("text-[11px]", overdue ? "text-bad" : "text-faint")}>
                {h.skillName} · {compact ? whenLabel(h.dueAt, now) : timeLabel(h.dueAt)}
                {overdue ? " · overdue" : ""}
              </p>
              {!compact && h.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{h.description}</p>}
            </button>
          )}
        />
      </div>
      {asking && !done && (
        <div className="mt-2 border-t border-line pt-2">
          <p className="mb-1.5 text-[11px] text-muted">How long did it take?</p>
          <div className="flex flex-wrap gap-1">
            {MINUTES.map((m) => (
              <button key={m} type="button" disabled={busy} onClick={() => complete(m)} className="rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent hover:text-accent">
                {minutesLabel(m)}
              </button>
            ))}
            <button type="button" disabled={busy} onClick={() => complete(null)} className="rounded-md px-2 py-0.5 text-xs text-muted hover:text-ink">
              Just tick
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- test row ---

/** "Revision 30 / 90 min · 1 / 2 days", sized from the subject's grade and trend. */
function RevisionBar({ r }: { r: NonNullable<TestItem["revision"]> }) {
  const done = r.state === "completed";
  const pct = r.minutes.target ? Math.min(100, (r.minutes.done / r.minutes.target) * 100) : 0;
  return (
    <a href={`/quests/${r.questId}`} title={r.reason ?? undefined} className="mt-2 block border-t border-line pt-2 text-[11px]">
      <span className="flex items-center justify-between gap-2">
        <span className={done ? "text-good" : "text-muted"}>{done ? "Revision done" : "Revision"}</span>
        <span className="text-faint">
          {r.minutes.done}/{r.minutes.target} min
          {r.days ? ` · ${r.days.done}/${r.days.target} days` : ""}
        </span>
      </span>
      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10">
        <span className={cn("block h-full rounded-full", done ? "bg-good" : "bg-accent")} style={{ width: `${done ? 100 : pct}%` }} />
      </span>
    </a>
  );
}

export function TestRow({ x, now, skills, lessons }: { x: TestItem; now: number; skills: SkillChoice[]; lessons: LessonChoices }) {
  const [score, setScore] = React.useState("");
  const [outOf, setOutOf] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const reward = useReward();
  const router = useRouter();
  const over = x.startAt + x.durationMin * 60_000 <= now;
  const needsResult = over && !x.assessmentId && !x.noResult && x.hasResultType;
  const cd = countdown(x.startAt, now);

  async function save() {
    setBusy(true);
    const r = await recordTestResultAction(x.id, Number(score), Number(outOf));
    setBusy(false);
    if (!r.ok) return reward.error(r.error);
    reward.reward(r.reward, { title: `${x.title}: ${score}/${outOf}` });
    router.refresh();
  }

  return (
    <div className={cn("rounded-lg border px-2.5 py-2", over ? "border-line bg-surface-2" : "border-bad/40 bg-bad/[0.08]")}>
      <TestDialog
        skills={skills}
        lessons={lessons}
        editing={x}
        trigger={(open) => (
          <button type="button" onClick={open} className="w-full text-left" aria-label={`Edit ${x.title}`}>
            <p className="flex items-center gap-1.5 text-sm font-medium leading-tight">
              <ClipboardList className="size-3.5 shrink-0 text-bad" />
              {x.title}
            </p>
            <p className="text-[11px] text-faint">
              {!over && <span className="mr-1 rounded bg-bad/20 px-1.5 font-medium text-bad">{cd}</span>}
              {KINDS[x.kind]} · {whenLabel(x.startAt, now)} · {minutesLabel(x.durationMin)}
              {x.assessmentId ? " · result recorded" : ""}
            </p>
            {x.notes && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{x.notes}</p>}
          </button>
        )}
      />
      {x.revision && !over && <RevisionBar r={x.revision} />}
      {needsResult && (
        <form
          data-track="test result"
          className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <span className="text-muted">Result</span>
          <Input value={score} onChange={(e) => setScore(e.target.value)} inputMode="decimal" className="h-7 w-14 px-2 text-xs" aria-label="Score" placeholder="38" />
          <span className="text-muted">out of</span>
          <Input value={outOf} onChange={(e) => setOutOf(e.target.value)} inputMode="decimal" className="h-7 w-14 px-2 text-xs" aria-label="Out of" placeholder="40" />
          <Button size="sm" className="h-7" disabled={busy || !score || !outOf}>
            Save
          </Button>
          <button
            type="button"
            className="text-faint hover:text-ink"
            onClick={async () => {
              await noTestResultAction(x.id);
              router.refresh();
            }}
          >
            No result
          </button>
        </form>
      )}
    </div>
  );
}
