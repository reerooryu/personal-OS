/** Called by the desktop app every 30 minutes to re-read the school's SOCS feed. Only reachable on 127.0.0.1. */
import { revalidatePath } from "next/cache";
import { appDb } from "@/services/bootstrap";
import { refreshFeed } from "@/services/calendar";

export const dynamic = "force-dynamic";

export async function POST() {
  const r = await refreshFeed(appDb());
  if (r.ok) revalidatePath("/", "layout");
  return Response.json(r);
}
