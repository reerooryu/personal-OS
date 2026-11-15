/** Receives usage-log batches from the app's own pages. Only reachable on 127.0.0.1. */
import { appDb } from "@/services/bootstrap";
import { recordUsage } from "@/services/usage";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { events?: unknown };
    const n = Array.isArray(body.events) ? recordUsage(appDb(), body.events) : 0;
    return Response.json({ ok: true, saved: n });
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
}
