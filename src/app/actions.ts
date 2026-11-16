"use server";
/**
 * Server actions. Each one calls a service and returns a plain result. No
 * progression math happens here: the services and the engine own all of it.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import * as t from "@/db/schema";
import { clearSampleData } from "@/seed/seed";
import {
  cancelTimer,
  createActivity,
  deleteActivity,
  findLikelyDuplicate,
  logTemplate,
  previewXp,
  restoreActivity,
  startTimer,
  stopTimer,
  updateActivity,
  type ActivityPatch,
} from "@/services/activities";
import { appDb } from "@/services/bootstrap";
import { getOpenedDb, dataDir } from "@/db/client";
import { backupTo } from "@/services/data";
import { answerCalendar, feedUrl, flipWeek, refreshFeed, setBreakScope, setCalendarRule, type CalendarAnswer } from "@/services/calendar";
import { verify } from "@/services/engine";
import {
  decideImport,
  deleteImportRule,
  importHealthJson,
  METRICS_ONLY_HINT,
  returnToReview,
  scanHealthFolder,
  setImportRule,
  type ImportDecision,
} from "@/services/health-import";
import {
  addHomework,
  addTest,
  completeHomework,
  deleteHomework,
  deleteTest,
  recordTestResult,
  reopenHomework,
  setNoResult,
  updateHomework,
  updateTest,
  type HomeworkInput,
  type TestInput,
} from "@/services/schoolwork";
import { setSetting } from "@/services/settings";
import { clearUsage } from "@/services/usage";
import { ValidationError, type Issue } from "@/services/errors";
import {
  awardMedal,
  createAssessment,
  createQuest,
  deleteAssessment,
  deleteQuest,
  removeMedalAward,
  setMilestone,
  setQuestStatus,
  updateAssessment,
} from "@/services/records";
import { withReward, type RewardSummary } from "@/services/rewards";
import { createSkill, deleteSkill, moveSkill, renameSkill, setSkillArchived } from "@/services/skills";
import type { ActivityInput, AssessmentInput, MedalAwardInput, QuestInput } from "@/validation/schemas";
import path from "node:path";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; issues?: Issue[]; code?: string };

function fail(e: unknown): { ok: false; error: string; issues?: Issue[] } {
  if (e instanceof ValidationError) return { ok: false, error: e.message, issues: e.issues };
  console.error(e);
  return { ok: false, error: "Something went wrong. Nothing was saved." };
}

function done() {
  revalidatePath("/", "layout");
}

type Rewarded = Result<{ reward: RewardSummary; activityId?: string; name?: string }>;

export async function logTemplateAction(templateId: string, clientRequestId: string): Promise<Rewarded> {
  try {
    const db = appDb();
    const { result, reward } = withReward(db, () => logTemplate(db, templateId, { clientRequestId }), (r) => r.activity.id);
    done();
    return { ok: true, reward, activityId: result.activity.id, name: result.activity.name };
  } catch (e) {
    return fail(e);
  }
}

export async function previewXpAction(a: { durationMin: number; difficulty: string; activityTypeId: string }): Promise<number> {
  return previewXp(appDb(), a).total;
}

export async function createActivityAction(input: ActivityInput, opts: { confirmDuplicate?: boolean } = {}): Promise<Rewarded> {
  try {
    const db = appDb();
    if (!opts.confirmDuplicate) {
      const dup = findLikelyDuplicate(db, input);
      if (dup && dup.clientRequestId !== input.clientRequestId) {
        return { ok: false, code: "duplicate", error: `This looks like a duplicate of "${dup.name}" logged at the same time.` };
      }
    }
    const { result, reward } = withReward(db, () => createActivity(db, input), (r) => r.activity.id);
    done();
    return { ok: true, reward, activityId: result.activity.id, name: result.activity.name };
  } catch (e) {
    return fail(e);
  }
}

export async function updateActivityAction(id: string, patch: ActivityPatch): Promise<Rewarded> {
  try {
    const db = appDb();
    const { reward } = withReward(db, () => updateActivity(db, id, patch), () => id);
    done();
    return { ok: true, reward, activityId: id };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteActivityAction(id: string): Promise<Result> {
  try {
    deleteActivity(appDb(), id);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreActivityAction(id: string): Promise<Result> {
  try {
    restoreActivity(appDb(), id);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function startTimerAction(templateId: string): Promise<Result> {
  try {
    startTimer(appDb(), templateId);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function stopTimerAction(opts: { confirmLong?: boolean } = {}): Promise<Rewarded> {
  try {
    const db = appDb();
    const { result, reward } = withReward(db, () => stopTimer(db, { confirmLong: opts.confirmLong }), (r) => r.activity.id);
    done();
    return { ok: true, reward, activityId: result.activity.id, name: result.activity.name };
  } catch (e) {
    const r = fail(e);
    if (r.issues?.some((i) => i.path === "confirmLong")) return { ...r, code: "confirm_long" };
    return r;
  }
}

export async function cancelTimerAction(): Promise<Result> {
  cancelTimer(appDb());
  done();
  return { ok: true };
}

export async function createAssessmentAction(input: AssessmentInput): Promise<Rewarded> {
  try {
    const db = appDb();
    const { reward } = withReward(db, () => createAssessment(db, input));
    done();
    return { ok: true, reward };
  } catch (e) {
    return fail(e);
  }
}

export async function updateAssessmentAction(id: string, patch: Partial<AssessmentInput>): Promise<Result> {
  try {
    updateAssessment(appDb(), id, patch);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAssessmentAction(id: string): Promise<Result> {
  try {
    deleteAssessment(appDb(), id);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function createQuestAction(input: QuestInput): Promise<Result<{ id: string }>> {
  try {
    const q = createQuest(appDb(), input);
    done();
    return { ok: true, id: q.id };
  } catch (e) {
    return fail(e);
  }
}

export async function setQuestStatusAction(id: string, status: "proposed" | "active" | "archived"): Promise<Result> {
  try {
    setQuestStatus(appDb(), id, status);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteQuestAction(id: string): Promise<Result> {
  try {
    deleteQuest(appDb(), id);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setMilestoneAction(requirementId: string, periodKey: string, checked: boolean): Promise<Rewarded> {
  try {
    const db = appDb();
    const { reward } = withReward(db, () => setMilestone(db, requirementId, periodKey, checked));
    done();
    return { ok: true, reward };
  } catch (e) {
    return fail(e);
  }
}

export async function awardMedalAction(input: MedalAwardInput): Promise<Rewarded> {
  try {
    const db = appDb();
    const { reward } = withReward(db, () => awardMedal(db, input));
    done();
    return { ok: true, reward };
  } catch (e) {
    return fail(e);
  }
}

export async function removeMedalAwardAction(id: string): Promise<Result> {
  try {
    removeMedalAward(appDb(), id);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function createSkillAction(input: { name: string; attributeId: string; parentId?: string | null }): Promise<Result<{ id: string }>> {
  try {
    const s = createSkill(appDb(), input);
    done();
    return { ok: true, id: s.id };
  } catch (e) {
    return fail(e);
  }
}

export async function renameSkillAction(id: string, name: string): Promise<Result> {
  try {
    renameSkill(appDb(), id, name);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function moveSkillAction(id: string, attributeId: string, parentId: string | null): Promise<Result> {
  try {
    moveSkill(appDb(), id, attributeId, parentId);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function archiveSkillAction(id: string, archived: boolean): Promise<Result> {
  setSkillArchived(appDb(), id, archived);
  done();
  return { ok: true };
}

export async function deleteSkillAction(id: string): Promise<Result> {
  try {
    deleteSkill(appDb(), id);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setTemplatePinnedAction(id: string, pinned: boolean): Promise<Result> {
  appDb().update(t.activityTemplates).set({ pinned }).where(eq(t.activityTemplates.id, id)).run();
  done();
  return { ok: true };
}

export async function markNoticesReadAction(): Promise<Result> {
  appDb().update(t.notices).set({ readAt: Date.now() }).run();
  done();
  return { ok: true };
}

export async function renameCharacterAction(name: string): Promise<Result> {
  const n = name.trim();
  if (!n || n.length > 40) return { ok: false, error: "Use a name under 40 characters" };
  appDb().update(t.profile).set({ characterName: n }).where(eq(t.profile.id, 1)).run();
  done();
  return { ok: true };
}

export async function clearSampleDataAction(): Promise<Result> {
  try {
    backupTo(getOpenedDb(), path.join(dataDir(), "backups"));
    clearSampleData(appDb());
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function verifyAction(): Promise<Result<{ differences: string[] }>> {
  return { ok: true, differences: verify(appDb()).slice(0, 50) };
}

export async function backupNowAction(): Promise<Result<{ file: string }>> {
  try {
    appDb();
    return { ok: true, file: backupTo(getOpenedDb(), path.join(dataDir(), "backups")) };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------- usage log ---

export async function setUsageLogAction(enabled: boolean): Promise<Result> {
  setSetting(appDb(), "usageLog", enabled);
  done();
  return { ok: true };
}

export async function clearUsageAction(): Promise<Result> {
  clearUsage(appDb());
  done();
  return { ok: true };
}

// ---------------------------------------------------------- Apple Health ---

type ScanResult = Result<{ added: number; message: string }>;

function scanMessage(r: ReturnType<typeof scanHealthFolder>): ScanResult {
  if ("skipped" in r) return { ok: false, error: r.skipped ?? "Choose a folder first" };
  if (r.error && !r.added) return { ok: false, error: r.error };
  const msg = r.added ? `Found ${r.added} new workout${r.added === 1 ? "" : "s"}.` : "No new workouts.";
  return { ok: true, added: r.added, message: r.error ? `${msg} One file couldn't be read: ${r.error}` : msg };
}

export async function setHealthFolderAction(folder: string | null): Promise<ScanResult> {
  try {
    const db = appDb();
    setSetting(db, "healthFolder", folder?.trim() || null);
    setSetting(db, "healthFiles", {});
    if (!folder?.trim()) {
      done();
      return { ok: true, added: 0, message: "Folder removed." };
    }
    const r = scanMessage(scanHealthFolder(db));
    done();
    return r;
  } catch (e) {
    return fail(e);
  }
}

export async function scanHealthAction(): Promise<ScanResult> {
  try {
    const r = scanMessage(scanHealthFolder(appDb()));
    done();
    return r;
  } catch (e) {
    return fail(e);
  }
}

export async function uploadHealthFileAction(form: FormData): Promise<ScanResult> {
  try {
    const f = form.get("file");
    if (!(f instanceof File)) return { ok: false, error: "Choose a file" };
    if (f.size > 50 * 1024 * 1024) return { ok: false, error: "That file is over 50 MB. Export a shorter date range." };
    const r = importHealthJson(appDb(), await f.text(), f.name);
    done();
    if (!r.found) return { ok: false, error: r.metricsOnly ? METRICS_ONLY_HINT : "No workouts in that file. Export workouts as JSON from Health Auto Export." };
    return { ok: true, added: r.added, message: r.added ? `Found ${r.added} new workout${r.added === 1 ? "" : "s"}.` : "Those workouts were already imported." };
  } catch (e) {
    return fail(e);
  }
}

export async function decideImportAction(d: ImportDecision): Promise<Rewarded> {
  try {
    const db = appDb();
    const { reward } = withReward(db, () => decideImport(db, d), () => db.select().from(t.importItems).where(eq(t.importItems.id, d.itemId)).get()?.activityId ?? null);
    done();
    return { ok: true, reward };
  } catch (e) {
    return fail(e);
  }
}

export async function setImportRuleAction(workoutType: string, rule: { action: "log" | "ignore"; skillId?: string | null }): Promise<Result> {
  try {
    setImportRule(appDb(), workoutType, rule);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteImportRuleAction(workoutType: string): Promise<Result> {
  deleteImportRule(appDb(), workoutType);
  done();
  return { ok: true };
}

export async function returnToReviewAction(itemId: string): Promise<Result> {
  try {
    returnToReview(appDb(), itemId);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- calendar ---

export async function answerCalendarAction(a: CalendarAnswer): Promise<Rewarded> {
  try {
    const db = appDb();
    const { result, reward } = withReward(db, () => answerCalendar(db, a), (r) => r.activityId);
    done();
    return { ok: true, reward, activityId: result.activityId ?? undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function refreshFeedAction(): Promise<Result<{ count: number }>> {
  const r = await refreshFeed(appDb());
  done();
  return r.ok ? { ok: true, count: r.count } : { ok: false, error: r.error };
}

export async function setFeedUrlAction(url: string): Promise<Result<{ count: number }>> {
  try {
    const db = appDb();
    if (!url.trim()) {
      setSetting(db, "socsFeedUrl", null);
      done();
      return { ok: true, count: 0 };
    }
    feedUrl(url);
    setSetting(db, "socsFeedUrl", url.trim());
    return refreshFeedAction();
  } catch (e) {
    return fail(e);
  }
}

export async function flipWeekAction(): Promise<Result> {
  try {
    flipWeek(appDb());
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setBreakScopeAction(id: string, scope: "school" | "everything"): Promise<Result> {
  setBreakScope(appDb(), id, scope);
  done();
  return { ok: true };
}

export async function setCalendarRuleAction(titleKey: string, rule: { action: "log" | "ignore"; skillId?: string | null; xp?: "normal" | "small" }): Promise<Result> {
  try {
    setCalendarRule(appDb(), titleKey, rule);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------- homework, tests ---

export async function saveHomeworkAction(id: string | null, input: HomeworkInput): Promise<Result> {
  try {
    const db = appDb();
    if (id) updateHomework(db, id, input);
    else addHomework(db, input);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteHomeworkAction(id: string): Promise<Result> {
  deleteHomework(appDb(), id);
  done();
  return { ok: true };
}

export async function completeHomeworkAction(id: string, minutes: number | null): Promise<Rewarded> {
  try {
    const db = appDb();
    const { result, reward } = withReward(db, () => completeHomework(db, id, minutes), (r) => r.activityId);
    done();
    return { ok: true, reward, activityId: result.activityId ?? undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function reopenHomeworkAction(id: string, removeActivity: boolean): Promise<Result> {
  try {
    reopenHomework(appDb(), id, removeActivity);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveTestAction(id: string | null, input: TestInput): Promise<Result> {
  try {
    const db = appDb();
    if (id) updateTest(db, id, input);
    else addTest(db, input);
    done();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTestAction(id: string): Promise<Result> {
  deleteTest(appDb(), id);
  done();
  return { ok: true };
}

export async function recordTestResultAction(id: string, score: number, outOf: number): Promise<Rewarded> {
  try {
    const db = appDb();
    const { reward } = withReward(db, () => recordTestResult(db, id, score, outOf));
    done();
    return { ok: true, reward };
  } catch (e) {
    return fail(e);
  }
}

export async function noTestResultAction(id: string): Promise<Result> {
  setNoResult(appDb(), id);
  done();
  return { ok: true };
}
