/** Downloads the usage log as CSV (default) or JSON. */
import { appDb } from "@/services/bootstrap";
import { usageCsv, usageEvents } from "@/services/usage";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const db = appDb();
  const day = new Date().toISOString().slice(0, 10);
  if (new URL(req.url).searchParams.get("format") === "json") {
    return new Response(JSON.stringify({ format: "ascend-usage", exportedAt: Date.now(), events: usageEvents(db) }, null, 1), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="ascend-usage-${day}.json"` },
    });
  }
  return new Response(usageCsv(db), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="ascend-usage-${day}.csv"` },
  });
}
