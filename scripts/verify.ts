/** The rebuild check: recomputes every derived record and reports differences. */
import { openDb } from "@/db/client";
import { verify } from "@/services/engine";

const { db } = openDb();
const diffs = verify(db);
if (diffs.length === 0) {
  console.log("All totals verified: every derived record matches its sources.");
} else {
  console.error(`${diffs.length} difference(s) found:`);
  for (const d of diffs.slice(0, 50)) console.error(`  ${d}`);
  process.exit(1);
}
