import { Plus } from "lucide-react";
import Link from "next/link";
import { QuickEntry } from "@/components/log/quick-entry";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ActivityRow, Empty, PageHeader } from "@/components/views/bits";
import { dateLabel, fmt, minutesLabel } from "@/lib/utils";
import { appDb } from "@/services/bootstrap";
import { activityHistory, formOptions } from "@/services/views";

export const dynamic = "force-dynamic";

export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<{ skill?: string }> }) {
  const { skill } = await searchParams;
  const db = appDb();
  const options = formOptions(db);
  const list = activityHistory(db, { limit: 300, skillId: skill || undefined });
  const days = new Map<string, typeof list>();
  for (const a of list) days.set(a.day, [...(days.get(a.day) ?? []), a]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Activities"
        subtitle="Everything you've logged. Each one feeds XP, quests, the journal and your stats."
        action={
          <Link href="/activities/new" className={buttonVariants()}>
            <Plus /> Log with details
          </Link>
        }
      />
      <Card className="mb-5">
        <CardBody className="pt-5">
          <QuickEntry />
        </CardBody>
      </Card>
      <form className="mb-4 flex items-center gap-2 text-sm">
        <label className="text-muted" htmlFor="skill">
          Skill
        </label>
        <select id="skill" name="skill" defaultValue={skill ?? ""} className="h-8 rounded-lg border border-line bg-bg px-2 text-sm">
          <option value="">All skills</option>
          {options.skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="h-8 rounded-lg border border-line px-3 text-muted hover:text-ink">Filter</button>
      </form>
      {list.length === 0 && <Empty>No activities yet. Type one above, like &quot;piano 30&quot;.</Empty>}
      <div className="space-y-4">
        {[...days].map(([day, items]) => (
          <Card key={day}>
            <div className="flex items-baseline justify-between px-5 pt-4">
              <h2 className="text-sm font-semibold">{dateLabel(items[0]!.startAt)}</h2>
              <p className="text-xs text-muted">
                {minutesLabel(items.reduce((s, a) => s + a.durationMin, 0))} · +{fmt(items.reduce((s, a) => s + a.xp, 0))} XP
              </p>
            </div>
            <CardBody className="pt-1">
              {items.map((a) => (
                <ActivityRow key={a.id} a={a} showDate={false} />
              ))}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
