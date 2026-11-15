"use client";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { createActivityAction, updateActivityAction } from "@/app/actions";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { DIFFICULTIES, DIFFICULTY_LABELS, type Difficulty } from "@/domain/types";
import { fromLocalInput, toLocalInput } from "@/lib/local-time";
import { newRequestId } from "@/lib/utils";
import type { Issue } from "@/services/errors";

export interface FormOptions {
  skills: { id: string; name: string; attributeId: string }[];
  activityTypes: { id: string; name: string }[];
  measurementTypes: { id: string; skillId: string; name: string; valueKind: string; unit: string | null; gradeScale: { label: string; score: number }[] | null }[];
}

export interface ActivityDraft {
  name: string;
  startAt: number;
  durationMin: number;
  activityTypeId: string;
  difficulty: Difficulty;
  skills: { skillId: string; weight: number }[];
  notes: string;
}

interface ResultRow {
  measurementTypeId: string;
  value: string;
  record: boolean;
}

function evenWeights(n: number): number[] {
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => base + (i < 100 - base * n ? 1 : 0));
}

export function ActivityForm({ options, initial, activityId, onSaved }: { options: FormOptions; initial: ActivityDraft; activityId?: string; onSaved?: (id: string) => void }) {
  const [d, setD] = React.useState(initial);
  const [when, setWhen] = React.useState(toLocalInput(initial.startAt));
  const [results, setResults] = React.useState<ResultRow[]>([]);
  const [confirmLong, setConfirmLong] = React.useState(false);
  const [issues, setIssues] = React.useState<Issue[]>([]);
  const [dup, setDup] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const requestId = React.useRef(newRequestId());
  const reward = useReward();
  const router = useRouter();
  const err = (p: string) => issues.find((i) => i.path === p || i.path.startsWith(`${p}.`))?.message;

  const setSkillCount = (skills: ActivityDraft["skills"]) => {
    const w = evenWeights(skills.length || 1);
    setD({ ...d, skills: skills.map((s, i) => ({ ...s, weight: w[i]! })) });
  };
  const weightSum = d.skills.reduce((s, k) => s + k.weight, 0);
  const chosen = new Set(d.skills.map((s) => s.skillId));
  const measurable = options.measurementTypes.filter((m) => chosen.has(m.skillId));

  async function submit(confirmDuplicate = false) {
    setBusy(true);
    setIssues([]);
    const startAt = fromLocalInput(when);
    const r = activityId
      ? await updateActivityAction(activityId, { ...d, startAt, notes: d.notes || null, confirmLong: true })
      : await createActivityAction(
          {
            ...d,
            startAt,
            notes: d.notes || null,
            confirmLong,
            clientRequestId: requestId.current,
            results: results
              .filter((x) => x.measurementTypeId && x.value !== "")
              .map((x) => {
                const mt = options.measurementTypes.find((m) => m.id === x.measurementTypeId)!;
                return mt.valueKind === "grade"
                  ? { measurementTypeId: mt.id, rawLabel: x.value, recordAsAssessment: x.record }
                  : { measurementTypeId: mt.id, rawValue: Number(x.value), recordAsAssessment: x.record };
              }),
          },
          { confirmDuplicate },
        );
    setBusy(false);
    if (!r.ok) {
      if ("code" in r && r.code === "duplicate") return setDup(r.error);
      setIssues(("issues" in r && r.issues) || []);
      if (!("issues" in r) || !r.issues?.length) reward.error(r.error);
      return;
    }
    reward.reward(r.reward, { title: activityId ? "Activity updated" : d.name, activityId: activityId ? undefined : r.activityId });
    router.refresh();
    onSaved?.(r.activityId ?? activityId ?? "");
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <Label>What did you do?</Label>
        <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Piano practice: Pop Bossa" maxLength={120} />
        <FieldError>{err("name")}</FieldError>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2">
          <Label>When it started</Label>
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <FieldError>{err("startAt")}</FieldError>
        </div>
        <div>
          <Label>Minutes</Label>
          <Input type="number" min={1} max={480} value={d.durationMin} onChange={(e) => setD({ ...d, durationMin: Number(e.target.value) })} />
          <FieldError>{err("durationMin")}</FieldError>
        </div>
        <div>
          <Label>Difficulty</Label>
          <Select value={d.difficulty} onChange={(e) => setD({ ...d, difficulty: e.target.value as Difficulty })}>
            {DIFFICULTIES.map((x) => (
              <option key={x} value={x}>
                {DIFFICULTY_LABELS[x]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label>Type</Label>
        <Select value={d.activityTypeId} onChange={(e) => setD({ ...d, activityTypeId: e.target.value })}>
          {options.activityTypes.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label hint={d.skills.length > 1 ? `(weights must add up to 100%, now ${weightSum}%)` : undefined}>Skills</Label>
        <div className="space-y-2">
          {d.skills.map((s, i) => (
            <div key={i} className="flex gap-2">
              <Select value={s.skillId} onChange={(e) => setD({ ...d, skills: d.skills.map((x, j) => (j === i ? { ...x, skillId: e.target.value } : x)) })}>
                {options.skills.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </Select>
              {d.skills.length > 1 && (
                <>
                  <Input
                    type="number"
                    className="w-20"
                    min={1}
                    max={100}
                    value={s.weight}
                    onChange={(e) => setD({ ...d, skills: d.skills.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)) })}
                    aria-label="Weight percent"
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => setSkillCount(d.skills.filter((_, j) => j !== i))} aria-label="Remove skill">
                    <Trash2 />
                  </Button>
                </>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSkillCount([...d.skills, { skillId: options.skills.find((k) => !chosen.has(k.id))?.id ?? options.skills[0]!.id, weight: 0 }])}
          >
            <Plus /> Add a skill
          </Button>
        </div>
        <FieldError>{err("skills")}</FieldError>
      </div>
      <div>
        <Label hint="(optional)">Notes</Label>
        <Textarea value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
      </div>
      {!activityId && measurable.length > 0 && (
        <div>
          <Label hint="(optional: a time, score or grade from this session)">Measured results</Label>
          <div className="space-y-2">
            {results.map((r, i) => {
              const mt = options.measurementTypes.find((m) => m.id === r.measurementTypeId);
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select className="w-56" value={r.measurementTypeId} onChange={(e) => setResults(results.map((x, j) => (j === i ? { ...x, measurementTypeId: e.target.value, value: "" } : x)))}>
                    {measurable.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                  {mt?.valueKind === "grade" ? (
                    <Select className="w-44" value={r.value} onChange={(e) => setResults(results.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                      <option value="">Choose</option>
                      {mt.gradeScale?.map((g) => (
                        <option key={g.label} value={g.label}>
                          {g.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input className="w-32" type="number" step="any" placeholder={mt?.unit ?? ""} value={r.value} onChange={(e) => setResults(results.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input type="checkbox" checked={r.record} onChange={(e) => setResults(results.map((x, j) => (j === i ? { ...x, record: e.target.checked } : x)))} />
                    Record as assessment
                  </label>
                </div>
              );
            })}
            <Button type="button" variant="ghost" size="sm" onClick={() => setResults([...results, { measurementTypeId: measurable[0]!.id, value: "", record: true }])}>
              <Plus /> Add a result
            </Button>
          </div>
        </div>
      )}
      {!activityId && d.durationMin > 240 && (
        <label className="flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
          <input type="checkbox" checked={confirmLong} onChange={(e) => setConfirmLong(e.target.checked)} />
          Yes, this session really was {d.durationMin} minutes
        </label>
      )}
      {err("confirmLong") && !confirmLong && <FieldError>{err("confirmLong")}</FieldError>}
      {dup && (
        <div className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
          {dup}{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => submit(true)}>
            Save anyway
          </button>
        </div>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {activityId ? "Save changes" : "Log activity"}
        </Button>
      </div>
    </form>
  );
}
