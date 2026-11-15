import { openDb } from "@/db/client";

const { file } = openDb();
console.log(`Database is up to date: ${file}`);
