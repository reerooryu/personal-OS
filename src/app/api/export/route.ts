import { exportData } from "@/services/data";
import { appDb } from "@/services/bootstrap";

export const dynamic = "force-dynamic";

export function GET() {
  const file = exportData(appDb());
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(file, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="ascend-export-${stamp}.json"`,
    },
  });
}
