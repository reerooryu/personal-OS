/**
 * Seeds a fresh database.
 *   npm run seed               catalog + private starting record + sample activities
 *   npm run seed -- --no-sample   without the sample activities
 */
import { openDb } from "@/db/client";
import { isSeeded, seedDatabase } from "@/seed/seed";
import { loadStartingRecord } from "@/seed/starting-record";
import { characterSummary } from "@/services/queries";

const { db, file } = openDb();
if (isSeeded(db)) {
  console.log(`Already seeded: ${file}. Delete the database file to start fresh.`);
  process.exit(0);
}
const startingRecord = loadStartingRecord();
seedDatabase(db, { sample: !process.argv.includes("--no-sample"), startingRecord });
const c = characterSummary(db);
console.log(`Seeded ${file}`);
console.log(startingRecord ? "Imported private/starting-record.json" : "No private/starting-record.json found, so no starting record was imported.");
console.log(`${c.name}: level ${c.level.level}, ${c.xp.toLocaleString("en-US")} XP`);
