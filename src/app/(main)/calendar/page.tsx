import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { DidYouGo } from "@/components/calendar/did-you-go";
import { FeedRefresher } from "@/components/calendar/feed-refresher";
import { Legend, WeekGrid } from "@/components/calendar/week-grid";
import { WeekKeys } from "@/components/calendar/week-keys";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Empty, PageHeader } from "@/components/views/bits";
import { addDays } from "@/domain/time";
import { requestTime } from "@/lib/clock";
import { dateLabel, timeLabel } from "@/lib/utils";
import { appDb } from "@/services/bootstrap";
import { calendarWeek, todayKey, upcomingTimetableCount } from "@/services/calendar";
import { getSetting } from "@/services/settings";
import { calendarInboxItems, skillChoices } from "@/services/views";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const db = appDb();
  const now = requestTime();
  const today = todayKey(db, now);
  const anchor = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const w = calendarWeek(db, anchor);
  const feed = getSetting(db, "socsFeedUrl");
  const last = getSetting(db, "socsLastFetch");
  const inbox = calendarInboxItems(db, now);
  const hasTimetable = upcomingTimetableCount(db) > 0;
  const nav = (d: string) => `/calendar?date=${d}`;
  const monthLabel = new Date(`${w.monday}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Calendar"
        subtitle="Plans live here. A session only becomes an activity when you say you went."
        action={<FeedRefresher connected={!!feed} stale={!last || now - last.at > 30 * 60_000} />}
      />
      {inbox.length > 0 && (
        <Card className="mb-5">
          <CardBody className="pt-5">
            <DidYouGo items={inbox} skills={skillChoices(db)} />
          </CardBody>
        </Card>
      )}
      {!hasTimetable && !feed ? (
        <Empty>No timetable yet. Add private/timetable.json, or connect the school calendar in Settings.</Empty>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link href={nav(addDays(w.monday, -7))} className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="Previous week">
                <ChevronLeft />
              </Link>
              <Link href={nav(addDays(w.monday, 7))} className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="Next week">
                <ChevronRight />
              </Link>
              <h2 className="text-lg font-semibold">{monthLabel}</h2>
              {w.week && <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">Week {w.week}</span>}
              {w.days.every((d) => d.date !== today) && (
                <Link href="/calendar" className="text-xs text-muted underline-offset-2 hover:underline">
                  Back to this week
                </Link>
              )}
            </div>
            <Legend />
          </div>
          <WeekKeys prev={nav(addDays(w.monday, -7))} next={nav(addDays(w.monday, 7))} today="/calendar" />
          <WeekGrid days={w.days} items={w.items} today={today} />
          <p className="mt-3 text-xs text-faint">
            {feed
              ? last?.error
                ? `School calendar: ${last.error}.`
                : last
                  ? `School calendar updated ${dateLabel(last.at)}, ${timeLabel(last.at)}.`
                  : "School calendar not read yet."
              : "School calendar not connected. Add the SOCS link in Settings."}{" "}
            Use ← and → to change week, T for this week.
          </p>
        </>
      )}
    </div>
  );
}
