import Link from "next/link";
import { AddSkillDialog } from "@/components/stats/skill-forms";
import { Badge, GradeBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/views/bits";
import { cn, dateLabel, fmt, minutesLabel } from "@/lib/utils";
import { appDb } from "@/services/bootstrap";
import { attributeSummaries, skillSummaries, type SkillSummary } from "@/services/queries";
import { formOptions } from "@/services/views";

export const dynamic = "force-dynamic";

export default function StatisticsPage() {
  const db = appDb();
  const attrs = attributeSummaries(db);
  const all = skillSummaries(db);
  const opts = formOptions(db);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Statistics"
        subtitle="Levels show effort. Grades show demonstrated ability, from assessments only."
        action={<AddSkillDialog attributes={opts.attributes} skills={opts.skills} />}
      />
      <div className="space-y-5">
        {attrs.map((a) => {
          const skills = all.filter((s) => s.attributeId === a.id && s.kind === "skill");
          const ordered: { s: SkillSummary; depth: number }[] = [];
          const walk = (parent: string | null, depth: number) => {
            for (const s of skills.filter((x) => x.parentId === parent)) {
              ordered.push({ s, depth });
              walk(s.id, depth + 1);
            }
          };
          walk(null, 0);
          return (
            <Card key={a.id}>
              <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />
                  <h2 className="font-semibold">{a.name}</h2>
                </div>
                {ordered.length > 0 && (
                  <div className="flex w-56 items-center gap-3 text-xs text-muted">
                    <span className="shrink-0">Lv {a.level.level}</span>
                    <Progress value={a.level.progress} color={a.color} />
                    <span className="shrink-0">{fmt(a.xp)}</span>
                  </div>
                )}
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="px-5 py-2 font-normal">Skill</th>
                    <th className="w-48 py-2 font-normal">Level</th>
                    <th className="w-24 py-2 text-right font-normal">Time</th>
                    <th className="w-56 px-5 py-2 text-right font-normal">Proficiency</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map(({ s, depth }) => (
                    <tr key={s.id} className={cn("border-t border-line", s.archived && "opacity-50")}>
                      <td className="px-5 py-2">
                        <Link href={`/statistics/${s.id}`} className="hover:text-accent" style={{ paddingLeft: depth * 18 }}>
                          {depth > 0 && <span className="mr-1 text-faint">└</span>}
                          {s.name}
                        </Link>
                        {s.archived && <Badge className="ml-2">Archived</Badge>}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-10 text-xs text-muted">Lv {s.level.level}</span>
                          <Progress value={s.level.progress} color={a.color} className="w-28" />
                        </div>
                      </td>
                      <td className="py-2 text-right text-muted">{s.minutes ? minutesLabel(s.minutes) : "–"}</td>
                      <td className="px-5 py-2">
                        <div className="flex items-center justify-end gap-2">
                          {s.assessedAt && (
                            <span className={cn("whitespace-nowrap text-xs", s.stale ? "text-warn" : "text-faint")} title={s.stale ? "Over a year old" : "Last assessed"}>
                              {dateLabel(s.assessedAt)}
                            </span>
                          )}
                          <span className="w-7 text-right text-xs text-muted">{s.proficiency ?? ""}</span>
                          <GradeBadge grade={s.grade} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {a.traits.map((t) => (
                    <tr key={t.id} className="border-t border-line">
                      <td className="px-5 py-2">
                        {t.name} <span className="text-xs text-faint">computed from habits</span>
                      </td>
                      <td colSpan={2} className="py-2 text-xs text-muted">
                        {t.score === null ? "Not enough data yet" : "Last 28 days"}
                      </td>
                      <td className="px-5 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-muted">{t.score ?? ""}</span>
                          <GradeBadge grade={t.grade} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
