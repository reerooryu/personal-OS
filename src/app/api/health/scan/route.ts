/** Called by the desktop app every 15 minutes and on wake. Only reachable on 127.0.0.1. */
import { revalidatePath } from "next/cache";
import { appDb } from "@/services/bootstrap";
import { scanHealthFolder } from "@/services/health-import";
import { unreadNotices } from "@/services/queries";

export const dynamic = "force-dynamic";

export function POST() {
  const db = appDb();
  const r = scanHealthFolder(db);
  if ("added" in r && r.added) revalidatePath("/", "layout");
  const latest = "added" in r && r.added ? unreadNotices(db).find((n) => n.kind === "health_import")?.message ?? null : null;
  return Response.json({ ok: true, ...r, notice: latest });
}
