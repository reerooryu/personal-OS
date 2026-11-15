"use client";
import { FolderOpen, RefreshCw, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteImportRuleAction, scanHealthAction, setHealthFolderAction, setImportRuleAction, uploadHealthFileAction } from "@/app/actions";
import { SkillSelect, type SkillChoice } from "@/components/imports/import-review";
import { useReward } from "@/components/reward/reward-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dateLabel, timeLabel } from "@/lib/utils";


export interface HealthSettingsProps {
  folder: string | null;
  guess: string | null;
  lastScan: { at: number; error: string | null; added: number } | null;
  stats: { total: number; imported: number; matched: number; ignored: number; pending: number; latest: number | null };
  rules: { workoutType: string; action: "log" | "ignore"; skillId: string | null; seen: number }[];
  skills: SkillChoice[];
}

const noop = () => () => {};
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function HealthSettings({ folder, guess, lastScan, stats, rules, skills }: HealthSettingsProps) {
  const [path, setPath] = React.useState(folder ?? guess ?? "");
  const [busy, setBusy] = React.useState(false);
  // In the desktop app a native folder picker is available; in a browser, type the path.
  const desktop = React.useSyncExternalStore(noop, () => !!window.ascend?.chooseFolder, () => false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const reward = useReward();
  const router = useRouter();

  async function run(p: Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok) reward.error(r.error ?? "Something went wrong");
    else if (r.message) reward.info(r.message);
    router.refresh();
  }

  async function choose() {
    const picked = await window.ascend!.chooseFolder!(folder ?? guess ?? undefined);
    if (picked) {
      setPath(picked);
      await run(setHealthFolderAction(picked));
    }
  }

  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-2">
        <p className="font-medium">Export folder</p>
        <p className="text-muted">The iCloud Drive folder Health Auto Export saves to. ASCEND checks it every 15 minutes and when the Mac wakes.</p>
        {desktop ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-bg px-3 py-2 text-xs">{folder ?? "No folder chosen"}</code>
            <Button variant="secondary" onClick={choose} disabled={busy}>
              <FolderOpen /> {folder ? "Change" : "Choose folder"}
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/…/Library/Mobile Documents/…" aria-label="Export folder path" />
            <Button variant="secondary" disabled={busy || path === (folder ?? "")} onClick={() => run(setHealthFolderAction(path))}>
              Save
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy || !folder} onClick={() => run(scanHealthAction())}>
            <RefreshCw /> Check now
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload /> Import a file
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="Health export file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.set("file", f);
              e.target.value = "";
              void run(uploadHealthFileAction(fd));
            }}
          />
          {folder && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(setHealthFolderAction(null))}>
              Stop watching
            </Button>
          )}
        </div>
        {lastScan && (
          <p className={lastScan.error ? "text-xs text-warn" : "text-xs text-faint"}>
            Last checked {dateLabel(lastScan.at)}, {timeLabel(lastScan.at)}
            {lastScan.error ? `. ${lastScan.error}` : lastScan.added ? `. Found ${lastScan.added} new.` : ". Nothing new."}
          </p>
        )}
      </div>

      {stats.total > 0 && (
        <p className="text-muted">
          {stats.total} workouts seen: {stats.imported} logged, {stats.matched} matched to sessions you logged yourself, {stats.ignored} ignored
          {stats.pending ? `, ${stats.pending} waiting for a skill` : ""}.{stats.latest ? ` Latest: ${dateLabel(stats.latest)}.` : ""}
        </p>
      )}

      {rules.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium">Workout types</p>
          <p className="text-muted">What each type from the watch counts as. Changes apply to new workouts. To fix one already logged, edit or delete it in Activities.</p>
          <div className="divide-y divide-line rounded-lg border border-line">
            {rules.map((r) => (
              <div key={r.workoutType} className="grid grid-cols-[1fr_200px_auto] items-center gap-3 px-3 py-2">
                <span>
                  {title(r.workoutType)} <span className="text-xs text-faint">· seen {r.seen}</span>
                </span>
                <SkillSelect
                  skills={skills}
                  includeIgnore
                  label={`Skill for ${r.workoutType}`}
                  value={r.action === "ignore" ? "__ignore" : (r.skillId ?? "")}
                  onChange={(v) => {
                    if (!v) return;
                    void run(setImportRuleAction(r.workoutType, v === "__ignore" ? { action: "ignore" } : { action: "log", skillId: v }));
                  }}
                />
                <Button size="sm" variant="ghost" aria-label={`Forget the rule for ${r.workoutType}`} title="Ask me again next time" onClick={() => run(deleteImportRuleAction(r.workoutType))}>
                  Reset
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
