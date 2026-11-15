import { ImportReview } from "@/components/imports/import-review";
import { CalendarSettings } from "@/components/settings/calendar-settings";
import { HealthSettings } from "@/components/settings/health-settings";
import { CharacterName, DataTools } from "@/components/settings/settings-controls";
import { UsagePanel } from "@/components/settings/usage-panel";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/views/bits";
import { DIFFICULTY_LABELS, type Difficulty } from "@/domain/types";
import { dataDir } from "@/db/client";
import { appDb } from "@/services/bootstrap";
import { currentFormula, getProfile } from "@/services/context";
import { breakList, calendarRuleList, currentWeek, todayKey, upcomingTimetableCount } from "@/services/calendar";
import { guessHealthFolder, importRuleList, importStats, pendingImports } from "@/services/health-import";
import { getSetting } from "@/services/settings";
import { usageSummary } from "@/services/usage";
import { sampleDataCount, skillChoices } from "@/services/views";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const db = appDb();
  const p = getProfile(db);
  const f = currentFormula(db);
  const skills = skillChoices(db);
  const pending = pendingImports(db);
  const feed = getSetting(db, "socsFeedUrl");
  let feedHost: string | null = null;
  try {
    feedHost = feed ? new URL(feed.replace(/^webcals?:/i, "https:")).host : null;
  } catch {
    feedHost = "Link saved";
  }
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
      <Card id="calendar">
        <CardHeader title="Calendar" />
        <CardBody>
          <CalendarSettings
            feedHost={feedHost}
            lastFetch={getSetting(db, "socsLastFetch")}
            week={currentWeek(db, todayKey(db))}
            slots={upcomingTimetableCount(db)}
            breaks={breakList(db)}
            rules={calendarRuleList(db)}
            skills={skills}
            apple={getSetting(db, "appleSync")}
          />
        </CardBody>
      </Card>
      <Card id="apple-health">
        <CardHeader title="Apple Health" subtitle="Workouts from the Garmin watch arrive here through Apple Health." />
        <CardBody className="space-y-5">
          {pending.length > 0 && (
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <ImportReview items={pending} skills={skills} />
            </div>
          )}
          <HealthSettings
            folder={getSetting(db, "healthFolder")}
            guess={guessHealthFolder()}
            lastScan={getSetting(db, "healthLastScan")}
            stats={importStats(db)}
            rules={importRuleList(db)}
            skills={skills}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Usage log" />
        <CardBody>
          <UsagePanel s={usageSummary(db)} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Other integrations" />
        <CardBody className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span>Google Calendar</span>
            <span className="text-muted">Not needed: the school calendar comes from SOCS, and ASCEND writes to Apple Calendar.</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Strava</span>
            <span className="text-right text-muted">Not used. Strava&apos;s API needs a paid plan and doesn&apos;t allow keeping data, so Garmin workouts come through Apple Health instead.</span>
          </div>
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
