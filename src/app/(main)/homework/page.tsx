import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { AddButtons, HomeworkRow, TestRow } from "@/components/schoolwork/schoolwork";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/views/bits";
import { weekdayOf } from "@/domain/calendar";
import { addDays, localToUtc } from "@/domain/time";
import { requestTime } from "@/lib/clock";
import { cn } from "@/lib/utils";
import { appDb } from "@/services/bootstrap";
import { currentWeek, todayKey } from "@/services/calendar";
import { getProfile } from "@/services/context";
import { homeworkBetween, lessonChoices, overdueHomework, testsAwaitingResult, testsBetween } from "@/services/schoolwork";
import { skillChoices } from "@/services/views";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

export default async function HomeworkPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const db = appDb();
  const now = requestTime();
  const zone = getProfile(db).timezone;
  const today = todayKey(db, now);
  const base = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const monday = addDays(base, 1 - weekdayOf(base));
  const startOf = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return localToUtc(zone, y!, m!, dd!);
  };
  const from = startOf(monday);
  const to = startOf(addDays(monday, 7));
  const homework = homeworkBetween(db, from, to);
  const tests = testsBetween(db, from, to);
  const earlierOverdue = overdueHomework(db, now).filter((h) => h.dueAt < from);
  const results = testsAwaitingResult(db, now).filter((x) => x.startAt < from);
  const later = testsBetween(db, to, to + 42 * DAY);
  const skills = skillChoices(db);
  const lessons = lessonChoices(db, now);
  const week = currentWeek(db, monday);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const dayOf = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: zone });
  const label = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const open = homework.filter((h) => !h.completedAt).length;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Homework"
        subtitle="Tick homework off as you finish it. Done on time feeds Time Management. Tests count down and ask for the result afterwards."
        action={<AddButtons skills={skills} lessons={lessons} />}
      />

      {(earlierOverdue.length > 0 || results.length > 0) && (
        <Card className="mb-5 border-bad/30">
          <CardHeader title="Still to do" subtitle="From earlier weeks" />
          <CardBody className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {earlierOverdue.map((h) => (
              <HomeworkRow key={h.id} h={h} now={now} skills={skills} lessons={lessons} compact />
            ))}
            {results.map((x) => (
              <TestRow key={x.id} x={x} now={now} skills={skills} lessons={lessons} />
            ))}
          </CardBody>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={`/homework?date=${addDays(monday, -7)}`} className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="Previous week">
          <ChevronLeft />
        </Link>
        <Link href={`/homework?date=${addDays(monday, 7)}`} className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="Next week">
          <ChevronRight />
        </Link>
        <h2 className="text-lg font-semibold">Week of {label(monday)}</h2>
        {week && <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">Week {week}</span>}
        <span className="text-sm text-muted">
          · {open ? `${open} to do` : homework.length ? "all done" : "nothing due"}
          {tests.length ? ` · ${tests.length} test${tests.length === 1 ? "" : "s"}` : ""}
        </span>
        {!days.includes(today) && (
          <Link href="/homework" className="text-xs text-muted underline-offset-2 hover:underline">
            Back to this week
          </Link>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[900px] grid-cols-7 gap-2">
          {days.map((d) => {
            const dayTests = tests.filter((x) => dayOf(x.startAt) === d);
            const dayHw = homework.filter((h) => dayOf(h.dueAt) === d);
            return (
              <div key={d} className={cn("min-h-48 rounded-xl border border-line bg-surface p-2", d === today && "border-accent/50 bg-accent/[0.05]")}>
                <p className={cn("mb-2 px-0.5 text-xs font-medium", d === today ? "text-accent" : "text-muted")}>{d === today ? `Today · ${label(d)}` : label(d)}</p>
                <div className="space-y-1.5">
                  {dayTests.map((x) => (
                    <TestRow key={x.id} x={x} now={now} skills={skills} lessons={lessons} />
                  ))}
                  {dayHw.map((h) => (
                    <HomeworkRow key={h.id} h={h} now={now} skills={skills} lessons={lessons} />
                  ))}
                  {!dayTests.length && !dayHw.length && <p className="px-0.5 text-[11px] text-faint">Nothing due</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {later.length > 0 && (
        <Card className="mt-5">
          <CardHeader title="Coming up" subtitle="Tests in the next six weeks" />
          <CardBody className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {later.map((x) => (
              <TestRow key={x.id} x={x} now={now} skills={skills} lessons={lessons} />
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
