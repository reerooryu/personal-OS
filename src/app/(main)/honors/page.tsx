import { Award, Lock, Trophy } from "lucide-react";
import { AwardMedalDialog, RemoveAwardButton } from "@/components/honors/award-form";
import { Badge, SampleBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Empty, PageHeader, TIER_TONE } from "@/components/views/bits";
import { cn, dateLabel, fmt } from "@/lib/utils";
import { appDb } from "@/services/bootstrap";
import { achievementList } from "@/services/queries";
import { formOptions, honors } from "@/services/views";

export const dynamic = "force-dynamic";

const TIER_COLOR = { gold: "text-gold", silver: "text-silver", bronze: "text-bronze" } as const;

export default function HonorsPage() {
  const db = appDb();
  const h = honors(db);
  const achievements = achievementList(db);
  const count = (tier: string) => h.awards.filter((a) => a.tier === tier).length;
  const totalXp = h.awards.reduce((s, a) => s + a.xp, 0);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Honors"
        subtitle="Medals are real-world honors and award XP. Achievements mark milestones in your record."
        action={
          <AwardMedalDialog
            medals={h.medals.filter((m) => m.awardRule === "manual")}
            skills={formOptions(db).skills}
            tierXp={h.tierXp}
          />
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["gold", "silver", "bronze"] as const).map((t) => (
          <Card key={t} className="p-4">
            <Award className={cn("size-5", TIER_COLOR[t])} />
            <p className="mt-2 text-2xl font-semibold">{count(t)}</p>
            <p className="text-xs capitalize text-muted">{t}</p>
          </Card>
        ))}
        <Card className="p-4">
          <Trophy className="size-5 text-accent" />
          <p className="mt-2 text-2xl font-semibold">{fmt(totalXp)}</p>
          <p className="text-xs text-muted">XP from medals</p>
        </Card>
      </div>
      <Card className="mb-5">
        <CardHeader title="Medal case" />
        <CardBody>
          {h.awards.length === 0 && <Empty>No medals yet.</Empty>}
          <ul className="divide-y divide-line">
            {h.awards.map((m) => (
              <li key={m.awardId} className="group flex items-start gap-3 py-2.5">
                <Award className={cn("mt-0.5 size-5 shrink-0", TIER_COLOR[m.tier])} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{m.occasion ?? m.name}</p>
                  <p className="text-xs text-muted">
                    {m.name} · {dateLabel(m.awardedAt)} · {fmt(m.xp)} XP
                    {m.origin === "linked" ? " · awarded by its quest" : ""}
                    {m.evidence ? ` · ${m.evidence}` : ""}
                  </p>
                </div>
                {m.isSample && <SampleBadge />}
                <Badge tone={TIER_TONE[m.tier]} className="capitalize">
                  {m.tier}
                </Badge>
                {m.origin === "manual" && <RemoveAwardButton id={m.awardId} />}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Achievements" subtitle={`${achievements.filter((a) => a.unlockedAt).length} of ${achievements.length} unlocked`} />
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {achievements.map((a) => (
            <div key={a.id} className={cn("flex gap-3 rounded-lg border border-line p-3", !a.unlockedAt && "opacity-50")}>
              {a.unlockedAt ? <Trophy className="mt-0.5 size-5 shrink-0 text-gold" /> : <Lock className="mt-0.5 size-5 shrink-0 text-faint" />}
              <div>
                <p className="text-sm font-medium">{a.name}</p>
                <p className="text-xs text-muted">{a.description}</p>
                {a.unlockedAt && <p className="mt-1 text-xs text-faint">{dateLabel(a.unlockedAt)}</p>}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
