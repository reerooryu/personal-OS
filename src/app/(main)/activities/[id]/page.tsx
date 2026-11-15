import { notFound } from "next/navigation";
import Link from "next/link";
import { ActivityActions } from "@/components/activities/activity-actions";
import { SampleBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Empty, PageHeader } from "@/components/views/bits";
import { DIFFICULTY_LABELS, type Difficulty } from "@/domain/types";
import { dateLabel, fmt, minutesLabel, timeLabel } from "@/lib/utils";
import { appDb } from "@/services/bootstrap";
import { activityDetail, formOptions } from "@/services/views";

export const dynamic = "force-dynamic";

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = appDb();
  const d = activityDetail(db, id);
  if (!d) notFound();
  const a = d.activity;
  const b = d.breakdown;
  const net = d.ledger.filter((e) => e.targetType === "character").reduce((s, e) => s + e.amount, 0);
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/activities" className="text-sm text-muted hover:text-ink">
        ← Activities
      </Link>
      <PageHeader
        title={a.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {dateLabel(a.startAt)}, {timeLabel(a.startAt)} · {minutesLabel(a.durationMin)} · {DIFFICULTY_LABELS[a.difficulty as Difficulty]} · {d.typeName}
            {a.isSample && <SampleBadge />}
            {a.deletedAt && <span className="text-bad">Deleted</span>}
          </span>
        }
        action={
          <ActivityActions
            id={a.id}
            deleted={a.deletedAt !== null}
            options={formOptions(db)}
            draft={{
              name: a.name,
              startAt: a.startAt,
              durationMin: a.durationMin,
              activityTypeId: a.activityTypeId,
              difficulty: a.difficulty as Difficulty,
              skills: d.skills.map((s) => ({ skillId: s.skillId, weight: s.weight })),
              notes: a.notes ?? "",
            }}
          />
        }
      />
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader title="How the XP was calculated" subtitle={`Formula version ${a.formulaVersionId}`} />
          <CardBody className="space-y-1.5 text-sm">
            <Row k="Effective minutes" v={b.effectiveMinutes === b.durationMin ? `${b.durationMin}` : `${b.taperThreshold} + ${b.taperRate} × ${b.durationMin - b.taperThreshold} = ${b.effectiveMinutes}`} />
            <Row k="Base rate" v={`× ${b.baseRate} XP per minute`} />
            <Row k="Difficulty" v={`× ${b.difficultyMultiplier}`} />
            <Row k="Activity type" v={`× ${b.typeMultiplier}`} />
            <div className="border-t border-line pt-2">
              <Row k="Activity XP" v={<span className="text-accent">{a.deletedAt ? `0 (was ${b.total})` : `+${b.total}`}</span>} />
            </div>
            <p className="pt-1 text-xs text-muted">
              Split across skills:{" "}
              {d.skills.map((s) => `${s.name} ${s.weight}%`).join(", ")}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="What it moved" />
          <CardBody className="space-y-1.5 text-sm">
            {d.contributions.length === 0 && d.completed.length === 0 && <Empty>It didn&apos;t count toward any quest.</Empty>}
            {d.contributions.map((c) => (
              <Row key={`${c.questId}-${c.requirementId}-${c.periodKey}`} k={c.questTitle} v={`+${Math.round(c.amount * 10) / 10}`} />
            ))}
            {d.completed.map((q) => (
              <p key={q} className="text-good">
                Completed {q}
              </p>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="XP ledger" subtitle={`Net character XP: ${fmt(net)}. Corrections are new entries, never edits.`} />
          <CardBody>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2 font-normal">#</th>
                  <th className="pb-2 font-normal">Target</th>
                  <th className="pb-2 font-normal">Reason</th>
                  <th className="pb-2 text-right font-normal">XP</th>
                </tr>
              </thead>
              <tbody>
                {d.ledger.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className="py-1.5 text-faint">{e.seq}</td>
                    <td className="py-1.5">{e.targetName}</td>
                    <td className="py-1.5 text-muted">{e.reason}</td>
                    <td className={`py-1.5 text-right ${e.amount < 0 ? "text-bad" : "text-accent"}`}>
                      {e.amount > 0 ? "+" : ""}
                      {e.amount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Journal entry" subtitle={d.journal?.userEdited ? "Edited by you" : "Written automatically"} />
          <CardBody className="text-sm text-ink/90">{d.journal ? d.journal.body : <Empty>No journal entry.</Empty>}</CardBody>
          {d.revisions.length > 0 && (
            <>
              <CardHeader title="Edit history" />
              <CardBody className="space-y-1 text-xs text-muted">
                {d.revisions.map((r) => {
                  const s = r.snapshot as { durationMin?: number; name?: string; startAt?: number };
                  return (
                    <p key={r.id}>
                      Version {r.revision}: {s.name}, {s.durationMin} min{s.startAt ? `, ${dateLabel(s.startAt)}` : ""}
                    </p>
                  );
                })}
              </CardBody>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
