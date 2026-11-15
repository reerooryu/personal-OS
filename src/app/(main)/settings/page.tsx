import { CharacterName, DataTools } from "@/components/settings/settings-controls";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/views/bits";
import { DIFFICULTY_LABELS, type Difficulty } from "@/domain/types";
import { dataDir } from "@/db/client";
import { appDb } from "@/services/bootstrap";
import { currentFormula, getProfile } from "@/services/context";
import { sampleDataCount } from "@/services/views";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const db = appDb();
  const p = getProfile(db);
  const f = currentFormula(db);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Settings" />
      <Card>
        <CardHeader title="Character" />
        <CardBody>
          <CharacterName name={p.characterName} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Data" />
        <CardBody>
          <DataTools samples={sampleDataCount(db)} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Progression" subtitle={`Formula version ${f.id}. Editing these arrives with milestone 3.`} />
        <CardBody className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
          <Item k="XP per minute" v={f.params.baseRate} />
          <Item k="Full rate up to" v={`${f.params.taperThreshold} min, then × ${f.params.taperRate}`} />
          {Object.entries(f.params.difficultyMultipliers).map(([k, v]) => (
            <Item key={k} k={`Difficulty: ${DIFFICULTY_LABELS[k as Difficulty]}`} v={`× ${v}`} />
          ))}
          <Item k="Character level curve" v={`${f.params.characterCurve.base} × L^${f.params.characterCurve.exponent}`} />
          <Item k="Skill level curve" v={`${f.params.skillCurve.base} × L^${f.params.skillCurve.exponent}`} />
          <Item k="Medal XP" v={`${f.params.medalTierXp.bronze} / ${f.params.medalTierXp.silver} / ${f.params.medalTierXp.gold}`} />
          <Item k="Day starts at" v={`${String(Math.floor(p.dayBoundaryMinutes / 60)).padStart(2, "0")}:00 (${p.timezone})`} />
          <Item k="Rest days per week" v={p.restDaysPerWeek} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Integrations" />
        <CardBody className="space-y-1.5 text-sm">
          {["Google Calendar", "Strava", "Apple Health"].map((n) => (
            <div key={n} className="flex justify-between">
              <span>{n}</span>
              <span className="text-muted">Not connected</span>
            </div>
          ))}
        </CardBody>
      </Card>
      <p className="text-xs text-faint">Data folder: {dataDir()}</p>
    </div>
  );
}

function Item({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{k}</span>
      <span>{v}</span>
    </div>
  );
}
