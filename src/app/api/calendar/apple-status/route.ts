/** The desktop app reports the result of each Apple Calendar sync here, for Settings. */
import { appDb } from "@/services/bootstrap";
import { setSetting, type Settings } from "@/services/settings";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = (await req.json()) as Partial<NonNullable<Settings["appleSync"]>>;
  setSetting(appDb(), "appleSync", {
    at: Date.now(),
    ok: !!b.ok,
    error: typeof b.error === "string" ? b.error.slice(0, 300) : null,
    added: Number(b.added) || 0,
    updated: Number(b.updated) || 0,
    removed: Number(b.removed) || 0,
    calendar: typeof b.calendar === "string" ? b.calendar.slice(0, 80) : null,
  });
  return Response.json({ ok: true });
}
