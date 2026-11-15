import { Flame, Trophy } from "lucide-react";
import Link from "next/link";
import { QuickEntry } from "@/components/log/quick-entry";
import { Tiles, type TileData } from "@/components/log/tiles";
import { TimerBar } from "@/components/log/timer-bar";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Progress, Ring } from "@/components/ui/progress";
import { ActivityRow, AttributeCard, Empty, MedalRow, QuestRow } from "@/components/views/bits";
import { Notices } from "@/components/views/notices";
import { dayKey, localParts } from "@/domain/time";
import { requestTime } from "@/lib/clock";
import { dateLabel, fmt, minutesLabel } from "@/lib/utils";
import { appDb } from "@/services/bootstrap";
import { loadSkillTree } from "@/services/context";
import { achievementList, attributeSummaries, characterSummary, medalCase, questBoard, unreadNotices } from "@/services/queries";
import { activityHistory, sampleDataCount, suggestedNow, tiles, timerView, today, weekInReview } from "@/services/views";

export const dynamic = "force-dynamic";

function greeting(hour: number) {
  return hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export default function Overview() {
  const db = appDb();
  const now = requestTime();
  const c = characterSummary(db, now);
  const attrs = attributeSummaries(db, now);
  const tree = loadSkillTree(db);
  const colorOf = (skillId: string | undefined) => attrs.find((a) => a.id === tree.skills.get(skillId ?? "")?.attributeId)?.color ?? "#7c9cff";
  const toTile = (x: ReturnType<typeof tiles>[number]): TileData => ({ id: x.id, name: x.name, durationMin: x.durationMin, color: colorOf(x.skills[0]?.skillId) });
  const suggested = suggestedNow(db, now).map(toTile);
  const tileList = tiles(db)
    .filter((x) => !suggested.some((s) => s.id === x.id))
    .slice(0, 8)
    .map(toTile);
  const timer = timerView(db);
  const t = today(db, now);
  const board = questBoard(db, now);
  const active = board.filter((q) => q.kind !== "daily" && (q.state === "active" || q.state === "completed")).sort((a, b) => Number(a.state === "completed") - Number(b.state === "completed") || b.progress - a.progress);
  const recent = activityHistory(db, { limit: 8 });
  const medals = medalCase(db).slice(0, 4);
  const unlocked = achievementList(db).filter((a) => a.unlockedAt).sort((a, b) => b.unlockedAt! - a.unlockedAt!).slice(0, 3);
  const local = localParts(now, "Asia/Bangkok");
  const isMonday = new Date(dayKey(now, { timezone: "Asia/Bangkok", dayBoundaryMinutes: 240 })).getUTCDay() === 1;
  const review = isMonday ? weekInReview(db, now) : null;
  const samples = sampleDataCount(db);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <p className="text-sm text-muted">{dateLabel(now)}</p>
          <h1 className="text-2xl font-semibold">
            {greeting(local.hour)}, {c.name}
          </h1>
        </div>
        {c.streak > 0 && (
          <p className="flex items-center gap-1.5 text-sm text-warn" title="Rest days are allowed and don't break your streak">
            <Flame className="size-4" /> {c.streak}-day streak
          </p>
        )}
      </div>

      <Notices items={unreadNotices(db)} />
      {samples > 0 && (
        <div className="mb-4 rounded-xl border border-warn/20 bg-warn/[0.06] px-4 py-2.5 text-sm text-warn">
          Showing {samples} sample activities so the app isn&apos;t empty. They&apos;re marked &quot;Sample&quot;.{" "}
          <Link href="/settings" className="underline underline-offset-2">
            Clear them in Settings
          </Link>{" "}
          when you&apos;re ready.
        </div>
      )}

      <Card className="mb-5">
        <CardBody className="space-y-4 pt-5">
          {timer && <TimerBar name={timer.name} startedAt={timer.startedAt} />}
          <QuickEntry />
          <Tiles tiles={tileList} suggested={suggested} timerRunning={!!timer} />
        </CardBody>
      </Card>

      <div className="mb-5 grid items-start gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Character" />
          <CardBody>
            <div className="flex items-center gap-4">
              <Ring value={c.level.progress} size={76} stroke={7} color="var(--color-accent)">
                <span className="text-xl font-semibold">{c.level.level}</span>
              </Ring>
              <div className="min-w-0">
                <p className="text-lg font-semibold">{c.name}</p>
                <p className="text-sm text-muted">{fmt(c.xp)} XP</p>
                <p className="text-xs text-faint">
                  {fmt(c.level.toNext)} XP to level {c.level.level + 1}
                </p>
              </div>
            </div>
            <Progress className="mt-4" value={c.level.progress} glow />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Today" subtitle={`${minutesLabel(t.minutes)} logged · ${t.sessions} session${t.sessions === 1 ? "" : "s"}`} />
          <CardBody>
            <div className="flex items-center gap-4">
              <Ring value={t.total ? t.done / t.total : 0} size={64}>
                <span className="text-sm font-semibold">
                  {t.done}/{t.total}
                </span>
              </Ring>
              <div className="min-w-0 flex-1 space-y-1">
                {t.objectives.length ? t.objectives.map((q) => <QuestRow key={q.id} q={q} />) : <Empty>No daily quests yet.</Empty>}
              </div>
            </div>
          </CardBody>
        </Card>

        {review ? (
          <Card>
            <CardHeader title="Last week in review" subtitle={review.week} />
            <CardBody className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="Time" value={minutesLabel(review.minutes)} />
              <Stat label="XP from activities" value={`+${fmt(review.xp)}`} />
              <Stat label="Sessions" value={String(review.sessions)} />
              <Stat label="Quests completed" value={String(review.quests)} />
              {review.bestDay && <Stat label="Best day" value={`${dateLabel(Date.parse(review.bestDay.day))} (${minutesLabel(review.bestDay.minutes)})`} />}
              {review.medals > 0 && <Stat label="Medals" value={String(review.medals)} />}
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardHeader title="Honors" action={<Link href="/honors" className="text-xs text-muted hover:text-ink">All</Link>} />
            <CardBody className="pt-1">
              {medals.map((m) => (
                <MedalRow key={m.awardId} m={m} />
              ))}
              {unlocked.map((a) => (
                <p key={a.id} className="flex items-center gap-2 py-1 text-sm text-gold">
                  <Trophy className="size-4" /> {a.name}
                </p>
              ))}
              {!medals.length && !unlocked.length && <Empty>Medals and achievements will appear here.</Empty>}
            </CardBody>
          </Card>
        )}
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {attrs.map((a) => (
          <AttributeCard key={a.id} a={a} />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Active quests" action={<Link href="/quests" className="text-xs text-muted hover:text-ink">All quests</Link>} />
          <CardBody className="space-y-1">{active.length ? active.slice(0, 7).map((q) => <QuestRow key={q.id} q={q} />) : <Empty>No active quests.</Empty>}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent activities" action={<Link href="/activities" className="text-xs text-muted hover:text-ink">History</Link>} />
          <CardBody className="pt-1">{recent.length ? recent.map((a) => <ActivityRow key={a.id} a={a} />) : <Empty>Log your first activity above.</Empty>}</CardBody>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
