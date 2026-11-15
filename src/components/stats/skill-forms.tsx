"use client";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  archiveSkillAction,
  createAssessmentAction,
  createSkillAction,
  deleteAssessmentAction,
  deleteSkillAction,
  moveSkillAction,
  renameSkillAction,
  updateAssessmentAction,
} from "@/app/actions";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { fromLocalDate, toLocalDate } from "@/lib/local-time";

type Attr = { id: string; name: string };
type SkillOpt = { id: string; name: string; attributeId: string };

export function AddSkillDialog({ attributes, skills }: { attributes: Attr[]; skills: SkillOpt[] }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [attributeId, setAttributeId] = React.useState(attributes[0]?.id ?? "");
  const [parentId, setParentId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Plus /> Add skill
        </Button>
      </DialogTrigger>
      <DialogContent title="Add a skill" description="Skills can be renamed, moved or archived later.">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await createSkillAction({ name, attributeId, parentId: parentId || null });
            if (!r.ok) return setError(r.error);
            setOpen(false);
            setName("");
            router.push(`/statistics/${r.id}`);
          }}
        >
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sight-reading" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Attribute</Label>
              <Select value={attributeId} onChange={(e) => (setAttributeId(e.target.value), setParentId(""))}>
                {attributes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label hint="(optional)">Inside skill</Label>
              <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">None (top level)</option>
                {skills
                  .filter((s) => s.attributeId === attributeId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </Select>
            </div>
          </div>
          <FieldError>{error}</FieldError>
          <div className="flex justify-end">
            <Button type="submit">Add skill</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface MT {
  id: string;
  name: string;
  valueKind: string;
  unit: string | null;
  gradeScale: { label: string; score: number }[] | null;
  weight: number;
}

const METHODS = [
  ["examination", "Examination"],
  ["timed_test", "Timed test"],
  ["competition", "Competition result"],
  ["formal_assessment", "Formal assessment"],
  ["benchmark", "Benchmark"],
  ["school_report", "School report"],
  ["self_assessment", "Self-assessment"],
] as const;

export function AssessmentForm({ skillId, types }: { skillId: string; types: MT[] }) {
  const [mtId, setMtId] = React.useState(types[0]?.id ?? "");
  const [value, setValue] = React.useState("");
  const [date, setDate] = React.useState(() => toLocalDate(Date.now()));
  const [method, setMethod] = React.useState<(typeof METHODS)[number][0]>("examination");
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const reward = useReward();
  const router = useRouter();
  const mt = types.find((t) => t.id === mtId);
  if (!types.length) return <p className="text-sm text-muted">This skill has no measurement types yet.</p>;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const r = await createAssessmentAction({
          skillId,
          measurementTypeId: mtId,
          assessedAt: fromLocalDate(date),
          method,
          notes: notes || null,
          ...(mt?.valueKind === "grade" ? { rawLabel: value } : { rawValue: value === "" ? null : Number(value) }),
        });
        if (!r.ok) return setError(r.error);
        reward.reward(r.reward, { title: "Assessment recorded" });
        setValue("");
        setNotes("");
        router.refresh();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Measurement</Label>
          <Select value={mtId} onChange={(e) => (setMtId(e.target.value), setValue(""))}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.weight === 0 ? " (history only)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Result</Label>
          {mt?.valueKind === "grade" ? (
            <Select value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose</option>
              {mt.gradeScale?.map((g) => (
                <option key={g.label} value={g.label}>
                  {g.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} placeholder={mt?.unit ?? ""} />
          )}
        </div>
        <div>
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="col-span-2">
          <Label>How it was measured</Label>
          <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {METHODS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <div className="col-span-2">
          <Label hint="(optional)">Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-14" />
        </div>
      </div>
      <FieldError>{error}</FieldError>
      <div className="flex justify-end">
        <Button type="submit" disabled={!value}>
          Record assessment
        </Button>
      </div>
    </form>
  );
}

export function AssessmentRowActions({ id, notRepresentative }: { id: string; notRepresentative: boolean }) {
  const router = useRouter();
  const reward = useReward();
  return (
    <div className="flex gap-1">
      <button
        className="rounded px-1.5 py-0.5 text-[11px] text-faint hover:bg-white/[0.06] hover:text-ink"
        onClick={async () => {
          const reason = notRepresentative ? null : window.prompt("Why doesn't this result reflect your ability? (for example, illness)");
          if (!notRepresentative && !reason) return;
          const r = await updateAssessmentAction(id, { notRepresentative: !notRepresentative, notRepresentativeReason: reason });
          if (!r.ok) return reward.error(r.error);
          router.refresh();
        }}
      >
        {notRepresentative ? "Count it" : "Not representative"}
      </button>
      <button
        className="rounded px-1.5 py-0.5 text-[11px] text-faint hover:bg-white/[0.06] hover:text-bad"
        onClick={async () => {
          if (!window.confirm("Delete this assessment?")) return;
          const r = await deleteAssessmentAction(id);
          if (!r.ok) return reward.error(r.error);
          router.refresh();
        }}
      >
        Delete
      </button>
    </div>
  );
}

export function ManageSkill({
  skill,
  attributes,
  parents,
}: {
  skill: { id: string; name: string; attributeId: string; parentId: string | null; archived: boolean; kind: string };
  attributes: Attr[];
  parents: SkillOpt[];
}) {
  const [name, setName] = React.useState(skill.name);
  const [attributeId, setAttributeId] = React.useState(skill.attributeId);
  const [parentId, setParentId] = React.useState(skill.parentId ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const router = useRouter();
  const reward = useReward();
  const run = async (p: Promise<{ ok: boolean; error?: string }>, msg: string) => {
    setError(null);
    const r = await p;
    if (!r.ok) return setError(r.error ?? "Failed");
    reward.info(msg);
    router.refresh();
  };
  if (skill.kind === "trait") return <p className="text-sm text-muted">Traits are computed from your habits and can&apos;t be edited.</p>;
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="secondary" onClick={() => run(renameSkillAction(skill.id, name), "Renamed")} disabled={name === skill.name}>
          Rename
        </Button>
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <Select value={attributeId} onChange={(e) => (setAttributeId(e.target.value), setParentId(""))}>
          {attributes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">Top level</option>
          {parents
            .filter((p) => p.attributeId === attributeId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                Inside {p.name}
              </option>
            ))}
        </Select>
        <Button
          variant="secondary"
          onClick={() => run(moveSkillAction(skill.id, attributeId, parentId || null), "Moved. Its history moved with it.")}
          disabled={attributeId === skill.attributeId && parentId === (skill.parentId ?? "")}
        >
          Move
        </Button>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => run(archiveSkillAction(skill.id, !skill.archived), skill.archived ? "Restored" : "Archived. History is kept.")}>
          {skill.archived ? "Unarchive" : "Archive"}
        </Button>
        <Button
          variant="danger"
          onClick={async () => {
            if (!window.confirm(`Delete ${skill.name}? This only works for skills with no history.`)) return;
            const r = await deleteSkillAction(skill.id);
            if (!r.ok) return setError(r.error);
            router.push("/statistics");
          }}
        >
          Delete
        </Button>
      </div>
      <FieldError>{error}</FieldError>
    </div>
  );
}
