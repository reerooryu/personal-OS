/**
 * Used by the menu-bar icon of the desktop app. Only reachable on 127.0.0.1.
 */
import { revalidatePath } from "next/cache";
import { cancelTimer, logTemplate, startTimer, stopTimer } from "@/services/activities";
import { appDb } from "@/services/bootstrap";
import { ValidationError } from "@/services/errors";
import { withReward } from "@/services/rewards";
import { tiles, timerView } from "@/services/views";

export const dynamic = "force-dynamic";

export function GET() {
  const db = appDb();
  return Response.json({
    timer: timerView(db),
    tiles: tiles(db)
      .slice(0, 8)
      .map((t) => ({ id: t.id, name: t.name, durationMin: t.durationMin })),
  });
}

export async function POST(req: Request) {
  const db = appDb();
  const body = (await req.json()) as { action: "log" | "start" | "stop" | "cancel"; templateId?: string; confirmLong?: boolean; requestId?: string };
  try {
    let out: Record<string, unknown> = {};
    if (body.action === "log" && body.templateId) {
      const { result, reward } = withReward(db, () => logTemplate(db, body.templateId!, { clientRequestId: body.requestId }), (r) => r.activity.id);
      out = { name: result.activity.name, xp: reward.xp, level: reward.character.level, leveledUp: reward.character.leveledUp, completed: reward.questsCompleted };
    } else if (body.action === "start" && body.templateId) {
      startTimer(db, body.templateId);
    } else if (body.action === "stop") {
      const { result, reward } = withReward(db, () => stopTimer(db, { confirmLong: body.confirmLong }), (r) => r.activity.id);
      out = { name: result.activity.name, xp: reward.xp, minutes: result.activity.durationMin, level: reward.character.level, leveledUp: reward.character.leveledUp, completed: reward.questsCompleted };
    } else if (body.action === "cancel") {
      cancelTimer(db);
    }
    revalidatePath("/", "layout");
    return Response.json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof ValidationError) {
      const code = e.issues.some((i) => i.path === "confirmLong") ? "confirm_long" : undefined;
      return Response.json({ ok: false, error: e.message, code });
    }
    console.error(e);
    return Response.json({ ok: false, error: "Something went wrong. Nothing was saved." }, { status: 500 });
  }
}
