import Link from "next/link";
import { notFound } from "next/navigation";
import { AssessmentForm, AssessmentRowActions, ManageSkill } from "@/components/stats/skill-forms";
import { Badge, GradeBadge, SampleBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ActivityRow, Empty, PageHeader, QuestRow } from "@/components/views/bits";
import { cn, dateLabel, fmt, minutesLabel } from "@/lib/utils";
import { appDb } from "@/services/bootstrap";
import { skillDetail } from "@/services/views";

export const dynamic = "force-dynamic";

const METHOD: Record<string, string> = {
  examination: "Exam",
  timed_test: "Timed test",
  competition: "Competition",
  formal_assessment: "Assessment",
  benchmark: "Benchmark",
  school_report: "School report",
  self_assessment: "Self-assessed",
};

export default async function SkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = skillDetail(appDb(), id);
  if (!d) notFound();
  const s = d.summary;
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/statistics" className="text-sm text-muted hover:text-ink">
        ← Statistics
      </Link>
      <PageHeader title={s.name} subtitle={`${minutesLabel(s.minutes)} logged across ${s.sessions} sessions`} />
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader title="Level" subtitle="Effort: grows with every session" />
          <CardBody>
            <div className="flex items-baseline justify-between">
              <p className="text-3xl font-semibold">Level {s.level.level}</p>
              <p className="text-sm text-muted">{fmt(s.xp)} XP</p>
            </div>
            <Progress className="mt-3" value={s.level.progress} glow />
            <p className="mt-2 text-xs text-muted">
              {fmt(s.level.toNext)} XP to level {s.level.level + 1}
              {s.ownXp !== s.xp ? ` · includes subskills` : ""}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Proficiency" subtitle="Ability: changes only with evidence" />
          <CardBody>
            <div className="flex items-center gap-4">
              <GradeBadge grade={s.grade} size="lg" />
              <div className="flex-1">
                <p className="text-sm">{s.proficiency === null ? "Not assessed yet" : `${s.proficiency} / 100`}</p>
                {s.nextGrade && (
                  <>
                    <Progress className="mt-2" value={s.gradeProgress} color="var(--color-good)" />
                    <p className="mt-1 text-xs text-muted">Progress toward {s.nextGrade}</p>
                  </>
                )}
                {s.assessedAt && (
                  <p className={cn("mt-1 text-xs", s.stale ? "text-warn" : "text-faint")}>
                    Last assessed {dateLabel(s.assessedAt)}
                    {s.stale ? " (over a year ago)" : ""}
                  </p>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Record an assessment" subtitle="An exam, a timed test, a competition result or a benchmark" />
          <CardBody>
            <AssessmentForm skillId={id} types={d.types} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Assessment history" />
          <CardBody className="space-y-2">
            {d.assessments.length === 0 && <Empty>No assessments yet.</Empty>}
            {d.assessments.map((a) => (
              <div key={a.id} className={cn("rounded-lg border border-line px-3 py-2", a.notRepresentative && "opacity-60")}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm">
                      {a.rawLabel ?? `${a.rawValue}${a.unit ? ` ${a.unit}` : ""}`} <span className="text-xs text-muted">{a.measurement}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {dateLabel(a.assessedAt)} · {METHOD[a.method] ?? a.method}
                      {a.notes ? ` · ${a.notes}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {a.isSample && <SampleBadge />}
                    {a.notRepresentative ? <Badge tone="warn">Not counted</Badge> : <span className="text-xs text-muted">{a.score}</span>}
                    <GradeBadge grade={a.notRepresentative ? null : a.grade} />
                  </div>
                </div>
                {a.notRepresentativeReason && <p className="mt-1 text-xs text-warn">{a.notRepresentativeReason}</p>}
                <div className="mt-1 flex justify-end">
                  <AssessmentRowActions id={a.id} notRepresentative={a.notRepresentative} />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent activities" action={<Link href={`/activities?skill=${id}`} className="text-xs text-muted hover:text-ink">All</Link>} />
          <CardBody className="pt-1">{d.recent.length ? d.recent.map((a) => <ActivityRow key={a.id} a={a} />) : <Empty>Nothing logged yet.</Empty>}</CardBody>
        </Card>
        <div className="space-y-5">
          {d.quests.length > 0 && (
            <Card>
              <CardHeader title="Quests" />
              <CardBody className="space-y-1">
                {d.quests.map((q) => (
                  <QuestRow key={q.id} q={q} />
                ))}
              </CardBody>
            </Card>
          )}
          {d.children.length > 0 && (
            <Card>
              <CardHeader title="Subskills" />
              <CardBody className="space-y-1.5 text-sm">
                {d.children.map((c) => (
                  <Link key={c.id} href={`/statistics/${c.id}`} className="flex justify-between hover:text-accent">
                    <span>{c.name}</span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      Lv {c.level.level} <GradeBadge grade={c.grade} />
                    </span>
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Manage" subtitle="Moving or renaming keeps all history" />
            <CardBody>
              <ManageSkill skill={d.skill} attributes={d.attributes} parents={d.possibleParents} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
