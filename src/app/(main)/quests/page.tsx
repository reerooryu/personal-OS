import { Lock, Plus } from "lucide-react";
import Link from "next/link";
import { Badge, SampleBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, PageHeader, progressText } from "@/components/views/bits";
import { appDb } from "@/services/bootstrap";
import { questBoard, type QuestCard } from "@/services/queries";

export const dynamic = "force-dynamic";

const STATE: Record<QuestCard["state"], { label: string; tone: "default" | "good" | "warn" | "accent" }> = {
  active: { label: "Active", tone: "accent" },
  completed: { label: "Done", tone: "good" },
  locked: { label: "Locked", tone: "default" },
  expired: { label: "Ended", tone: "warn" },
  proposed: { label: "Proposed", tone: "warn" },
  archived: { label: "Archived", tone: "default" },
};

function QuestTile({ q }: { q: QuestCard }) {
  const s = STATE[q.state];
  return (
    <Link href={`/quests/${q.id}`}>
      <Card className="h-full p-4 transition hover:border-white/20">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-snug">{q.title}</h3>
          <div className="flex shrink-0 gap-1">
            {q.isSample && <SampleBadge />}
            <Badge tone={s.tone}>
              {q.state === "locked" && <Lock className="size-3" />}
              {s.label}
            </Badge>
          </div>
        </div>
        {q.stage && q.stage.of > 1 && (
          <p className="mt-1 text-xs text-muted">
            Stage {q.stage.ordinal} of {q.stage.of}
            {q.stage.title ? `: ${q.stage.title}` : ""}
          </p>
        )}
        <ul className="mt-3 space-y-2">
          {q.requirements.map((r) => (
            <li key={r.id} className="text-xs">
              <div className="mb-1 flex justify-between gap-2 text-muted">
                <span className="truncate">{r.title ?? (r.type === "duration" ? "Time" : r.type === "sessions" ? "Sessions" : r.type === "distinct_days" ? "Days" : r.type)}</span>
                <span className={r.met ? "text-good" : "text-ink"}>{progressText(r)}</span>
              </div>
              <Progress value={r.type === "milestone" ? (r.met ? 1 : 0) : r.progress / r.target} color="var(--color-good)" />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-faint">Reward: {q.rewardXp} XP</p>
      </Card>
    </Link>
  );
}

export default function QuestsPage() {
  const board = questBoard(appDb());
  const live = (k: QuestCard["kind"]) => board.filter((q) => q.kind === k && q.state !== "proposed");
  const longTerm = live("long_term");
  const proposed = board.filter((q) => q.state === "proposed");
  const groups: [string, string, QuestCard[]][] = [
    ["daily", "Daily", live("daily")],
    ["weekly", "Weekly", live("weekly")],
    ["long", "Long-term", longTerm.filter((q) => q.state !== "completed")],
    ...(proposed.length ? [["proposed", `Proposed (${proposed.length})`, proposed] as [string, string, QuestCard[]]] : []),
    ["done", "Completed", longTerm.filter((q) => q.state === "completed")],
  ];
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Quests"
        subtitle="Progress comes only from logged activities, assessments and milestones you tick. Rewards are paid once."
        action={
          <Link href="/quests/new" className={buttonVariants()}>
            <Plus /> New quest
          </Link>
        }
      />
      <Tabs defaultValue="weekly">
        <TabsList className="mb-5">
          {groups.map(([v, label]) => (
            <TabsTrigger key={v} value={v}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        {groups.map(([v, , list]) => (
          <TabsContent key={v} value={v}>
            {list.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((q) => (
                  <QuestTile key={q.id} q={q} />
                ))}
              </div>
            ) : (
              <Empty>Nothing here yet.</Empty>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
