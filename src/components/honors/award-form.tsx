"use client";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { awardMedalAction, removeMedalAwardAction } from "@/app/actions";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FieldError, Input, Label, Select } from "@/components/ui/input";
import { fromLocalDate, toLocalDate } from "@/lib/local-time";

type Tier = "bronze" | "silver" | "gold";

export function AwardMedalDialog({ medals, skills, tierXp }: { medals: { id: string; name: string; tier: Tier }[]; skills: { id: string; name: string }[]; tierXp: Record<Tier, number> }) {
  const [open, setOpen] = React.useState(false);
  const [medalId, setMedalId] = React.useState(medals[0]?.id ?? "");
  const medal = medals.find((m) => m.id === medalId);
  const [tier, setTier] = React.useState<Tier>(medal?.tier ?? "bronze");
  const [occasion, setOccasion] = React.useState("");
  const [date, setDate] = React.useState(() => toLocalDate(Date.now()));
  const [skillId, setSkillId] = React.useState("");
  const [evidence, setEvidence] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const reward = useReward();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Award a medal
        </Button>
      </DialogTrigger>
      <DialogContent title="Award a medal" description="For real-world honors the app can't detect: a certificate, a team selection, a competition award.">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const key = `${date}-${occasion.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`;
            const r = await awardMedalAction({
              medalId,
              occasionKey: key,
              occasion: occasion || null,
              awardedAt: fromLocalDate(date),
              tierOverride: tier !== medal?.tier ? tier : null,
              skillsOverride: skillId ? [{ skillId, weight: 100 }] : null,
              evidence: evidence || null,
            });
            if (!r.ok) return setError(r.error);
            reward.reward(r.reward, { title: occasion || medal?.name });
            setOpen(false);
            setOccasion("");
            setEvidence("");
            router.refresh();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Medal</Label>
              <Select value={medalId} onChange={(e) => (setMedalId(e.target.value), setTier(medals.find((m) => m.id === e.target.value)?.tier ?? "bronze"))}>
                {medals.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Tier</Label>
              <Select value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
                {(["bronze", "silver", "gold"] as const).map((t) => (
                  <option key={t} value={t}>
                    {t[0]!.toUpperCase() + t.slice(1)} ({tierXp[t].toLocaleString("en-US")} XP)
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label>What for</Label>
            <Input value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="Innovate Award, Bangkok Qualifier (D'ohbotics)" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label hint="(optional)">XP goes to</Label>
              <Select value={skillId} onChange={(e) => setSkillId(e.target.value)}>
                <option value="">The medal&apos;s usual skills</option>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label hint="(optional)">Evidence</Label>
            <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Certificate file name or link" />
          </div>
          <FieldError>{error}</FieldError>
          <div className="flex justify-end">
            <Button type="submit" disabled={!occasion.trim()}>
              Award medal
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveAwardButton({ id }: { id: string }) {
  const router = useRouter();
  const reward = useReward();
  return (
    <button
      className="rounded p-1 text-faint opacity-0 hover:text-bad group-hover:opacity-100"
      aria-label="Remove medal"
      onClick={async () => {
        if (!window.confirm("Remove this medal? Its XP will be reversed.")) return;
        const r = await removeMedalAwardAction(id);
        if (!r.ok) return reward.error(r.error);
        router.refresh();
      }}
    >
      <X className="size-3.5" />
    </button>
  );
}
