import { appDb } from "@/services/bootstrap";
import { isSeeded } from "@/services/queries";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, seeded: isSeeded(appDb()) });
}
