"use client";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { createQuestAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { fromLocalDate } from "@/lib/local-time";

type Opt = { id: string; name: string; attributeId: string };
type ReqType = "duration" | "sessions" | "distinct_days" | "milestone" | "assessment";
interface Row {
  type: ReqType;
  target: number;
  scope: string;
  minSession: number;
  title: string;
  measurementTypeId: string;
  stage: number;
}

const TYPE_LABEL: Record<ReqType, string> = {
  duration: "Minutes of practice",
  sessions: "Number of sessions",
  distinct_days: "Days with practice",
  milestone: "A milestone you tick off",
  assessment: "Reach an assessment score",
};

export function QuestForm({
  skills,
  attributes,
  measurementTypes,
  defaults,
}: {
  skills: Opt[];
  attributes: { id: string; name: string }[];
  measurementTypes: { id: string; skillId: string; name: string }[];
  defaults: { daily: number; weekly: number };
}) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [kind, setKind] = React.useState<"daily" | "weekly" | "long_term">("weekly");
  const [reward, setReward] = React.useState<number | "">("");
  const [endDate, setEndDate] = React.useState("");
  const [rows, setRows] = React.useState<Row[]>([{ type: "duration", target: 120, scope: `skill:${skills[0]?.id}`, minSession: 0, title: "", measurementTypeId: measurementTypes[0]?.id ?? "", stage: 1 }]);
  const [error, setError] = React.useState<string | null>(null);
  const router = useRouter();

  const scopeSkills = (scope: string) =>
    scope.startsWith("attr:") ? skills.filter((s) => s.attributeId === scope.slice(5)).map((s) => s.id) : [scope.slice(6)];
  const firstSkill = rows.find((r) => r.scope.startsWith("skill:"))?.scope.slice(6);
  const defaultReward = kind === "daily" ? defaults.daily : kind === "weekly" ? defaults.weekly : 250;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const r = await createQuestAction({
      title,
      description: description || null,
      kind,
      rewardXp: reward === "" ? undefined : Number(reward),
      endAt: kind === "long_term" && endDate ? fromLocalDate(endDate) : null,
      skills: firstSkill ? [{ skillId: firstSkill, weight: 100 }] : [],
      requirements: rows.map((x) => ({
        stageOrdinal: x.stage,
        type: x.type,
        target: x.type === "milestone" ? 1 : x.target,
        title: x.type === "milestone" ? x.title || title : null,
        measurementTypeId: x.type === "assessment" ? x.measurementTypeId : null,
        filter:
          x.type === "milestone" || x.type === "assessment"
            ? {}
            : { skillIds: scopeSkills(x.scope), ...(x.minSession ? { minSessionMinutes: x.minSession } : {}) },
      })),
    });
    if (!r.ok) return setError(r.error);
    router.push(`/quests/${r.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label>Quest</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Practice sight-reading 4 times this week" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Repeats</Label>
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="long_term">Once (long-term goal)</option>
          </Select>
        </div>
        <div>
          <Label hint={`(default ${defaultReward})`}>Reward XP</Label>
          <Input type="number" min={0} value={reward} placeholder={String(defaultReward)} onChange={(e) => setReward(e.target.value === "" ? "" : Number(e.target.value))} />
        </div>
        {kind === "long_term" && (
          <div>
            <Label hint="(optional)">Deadline</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        )}
      </div>
      <div>
        <Label hint="(optional)">Why it matters</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-14" />
      </div>
      <div>
        <Label hint="(all must be met; later stages open when earlier ones finish)">Requirements</Label>
        <div className="space-y-3">
          {rows.map((r, i) => {
            const set = (patch: Partial<Row>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="space-y-2 rounded-lg border border-line p-3">
                <div className="flex gap-2">
                  <Select value={r.type} onChange={(e) => set({ type: e.target.value as ReqType })}>
                    {Object.entries(TYPE_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                  {kind === "long_term" && (
                    <Select className="w-28" value={r.stage} onChange={(e) => set({ stage: Number(e.target.value) })} aria-label="Stage">
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          Stage {n}
                        </option>
                      ))}
                    </Select>
                  )}
                  {rows.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove requirement">
                      <Trash2 />
                    </Button>
                  )}
                </div>
                {r.type === "milestone" ? (
                  <Input value={r.title} onChange={(e) => set({ title: e.target.value })} placeholder="Register for the exam" />
                ) : r.type === "assessment" ? (
                  <div className="flex gap-2">
                    <Select value={r.measurementTypeId} onChange={(e) => set({ measurementTypeId: e.target.value })}>
                      {measurementTypes.map((m) => (
                        <option key={m.id} value={m.id}>
                          {skills.find((s) => s.id === m.skillId)?.name}: {m.name}
                        </option>
                      ))}
                    </Select>
                    <Input type="number" className="w-28" min={1} max={100} value={r.target} onChange={(e) => set({ target: Number(e.target.value) })} aria-label="Score needed (0-100)" />
                  </div>
                ) : (
                  <div className="grid grid-cols-[1fr_100px_120px] gap-2">
                    <Select value={r.scope} onChange={(e) => set({ scope: e.target.value })}>
                      <optgroup label="Whole attribute">
                        {attributes.map((a) => (
                          <option key={a.id} value={`attr:${a.id}`}>
                            Any {a.name}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Skill (includes subskills)">
                        {skills.map((s) => (
                          <option key={s.id} value={`skill:${s.id}`}>
                            {s.name}
                          </option>
                        ))}
                      </optgroup>
                    </Select>
                    <Input type="number" min={1} value={r.target} onChange={(e) => set({ target: Number(e.target.value) })} aria-label="Target" />
                    <Input type="number" min={0} value={r.minSession || ""} placeholder="min/session" onChange={(e) => set({ minSession: Number(e.target.value) })} aria-label="Minimum minutes per session" />
                  </div>
                )}
              </div>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRows([...rows, { type: "sessions", target: 3, scope: rows[0]?.scope ?? `skill:${skills[0]?.id}`, minSession: 30, title: "", measurementTypeId: measurementTypes[0]?.id ?? "", stage: 1 }])}
          >
            <Plus /> Add a requirement
          </Button>
        </div>
      </div>
      <FieldError>{error}</FieldError>
      <div className="flex justify-end">
        <Button type="submit" disabled={!title.trim()}>
          Create quest
        </Button>
      </div>
    </form>
  );
}
