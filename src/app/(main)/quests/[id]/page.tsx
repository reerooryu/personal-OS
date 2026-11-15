import Link from "next/link";
import { notFound } from "next/navigation";
import { MilestoneCheck, QuestStatusButtons } from "@/components/quests/quest-controls";
import { Badge, SampleBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Empty, PageHeader, progressText } from "@/components/views/bits";
import { dateLabel, longDate } from "@/lib/utils";
import { appDb } from "@/services/bootstrap";
import { questDetail } from "@/services/views";

export const dynamic = "force-dynamic";

const KIND = { daily: "Daily", weekly: "Weekly", long_term: "Long-term" } as const;

export default async function QuestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = questDetail(appDb(), id);
  if (!d) notFound();
  const q = d.quest;
  const stages = d.evaluation?.stages ?? [];
  const reqById = new Map(d.requirements.map((r) => [r.id, r]));
  const ordinals = [...new Set(d.requirements.map((r) => r.stageOrdinal))];
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/quests" className="text-sm text-muted hover:text-ink">
        ← Quests
      </Link>
      <PageHeader
        title={q.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{KIND[q.kind]}</Badge>
            {q.kind !== "long_term" && <span>This period: {d.key}</span>}
            {q.endAt && <span>Deadline {longDate(q.endAt)}</span>}
            <span>Reward {q.rewardXp} XP</span>
            {d.medal && <Badge tone="silver">Medal: {d.medal.name}</Badge>}
            {q.isSample && <SampleBadge />}
          </span>
        }
        action={<QuestStatusButtons id={q.id} status={q.status} />}
      />
      {q.description && <p className="-mt-3 mb-5 text-sm text-muted">{q.description}</p>}
      {d.locked && (
        <p className="mb-4 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">Locked until you finish: {d.prereqs.join(", ")}</p>
      )}
      {d.parent && (
        <p className="mb-4 text-sm text-muted">
          Supports{" "}
          <Link href={`/quests/${d.parent.id}`} className="text-ink underline underline-offset-2">
            {d.parent.title}
          </Link>
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Card className="md:col-span-2">
          <CardHeader title={ordinals.length > 1 ? "Stages" : "Requirements"} subtitle={d.card?.state === "completed" ? "Completed this period" : undefined} />
          <CardBody className="space-y-5">
            {ordinals.map((o) => {
              const st = stages.find((s) => s.ordinal === o);
              const reqs = d.requirements.filter((r) => r.stageOrdinal === o);
              const open = !!st;
              return (
                <div key={o} className={open ? "" : "opacity-50"}>
                  {ordinals.length > 1 && (
                    <p className="mb-2 text-xs font-medium text-muted">
                      Stage {o}
                      {reqs[0]?.stageTitle ? `: ${reqs[0].stageTitle}` : ""}
                      {st?.completedAt ? ` · done ${dateLabel(st.completedAt)}` : open ? " · in progress" : " · opens after the previous stage"}
                    </p>
                  )}
                  <ul className="space-y-3">
                    {reqs.map((r) => {
                      const p = st?.requirements.find((x) => x.id === r.id) ?? { type: r.type, progress: 0, target: r.target, met: false };
                      const def = reqById.get(r.id)!;
                      return (
                        <li key={r.id}>
                          {r.type === "milestone" ? (
                            <MilestoneCheck requirementId={r.id} periodKey={d.key} checked={d.checks.has(r.id)} title={def.title ?? "Milestone"} disabled={d.locked || q.status !== "active"} />
                          ) : (
                            <>
                              <div className="mb-1 flex justify-between text-sm">
                                <span className="text-muted">{def.title ?? (r.type === "duration" ? "Time" : r.type === "sessions" ? `Sessions${def.filter.minSessionMinutes ? ` of ${def.filter.minSessionMinutes}+ min` : ""}` : r.type === "distinct_days" ? "Days" : r.type === "subquests" ? "Sub-quests" : "Score")}</span>
                                <span className={p.met ? "text-good" : ""}>{progressText(p)}</span>
                              </div>
                              <Progress value={p.progress / r.target} color="var(--color-good)" />
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="What counted" subtitle="The activities behind this period's progress" />
          <CardBody className="space-y-1.5 text-sm">
            {d.contributions.length === 0 && <Empty>Nothing yet.</Empty>}
            {d.contributions.map((c) => (
              <Link key={`${c.activityId}-${c.requirementId}`} href={`/activities/${c.activityId}`} className="flex justify-between gap-2 hover:text-accent">
                <span className="truncate">
                  {c.activity?.name} <span className="text-xs text-muted">{c.activity ? dateLabel(c.activity.startAt) : ""}</span>
                </span>
                <span className="shrink-0 text-muted">+{Math.round(c.amount * 10) / 10}</span>
              </Link>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="History" />
          <CardBody className="space-y-1.5 text-sm">
            {d.history.length === 0 && <Empty>Not completed yet.</Empty>}
            {d.history.map((h) => (
              <p key={h.periodKey} className="flex justify-between">
                <span>{q.kind === "long_term" ? "Completed" : h.periodKey}</span>
                <span className="text-muted">{dateLabel(h.completedAt)}</span>
              </p>
            ))}
            {d.children.length > 0 && (
              <div className="pt-3">
                <p className="mb-1 text-xs text-muted">Supporting quests</p>
                {d.children.map((c) => (
                  <Link key={c.id} href={`/quests/${c.id}`} className="block py-0.5 hover:text-accent">
                    {c.title}
                  </Link>
                ))}
              </div>
            )}
            {q.kind !== "long_term" && d.card && <p className="pt-2 text-xs text-faint">Resets each {q.kind === "daily" ? "day at 04:00" : "Monday at 04:00"}.</p>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
