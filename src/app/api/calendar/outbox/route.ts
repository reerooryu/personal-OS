/** What the desktop app writes into the "ASCEND" calendar in Apple Calendar. */
import { appDb } from "@/services/bootstrap";
import { appleOutbox } from "@/services/calendar";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(appleOutbox(appDb()));
}
