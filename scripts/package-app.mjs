/**
 * Builds ASCEND.app for Apple Silicon Macs.
 *   npm run package
 * Output: release/mac-arm64/ASCEND.app (drag it into Applications).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
const rm = (p) => fs.rmSync(path.join(root, p), { recursive: true, force: true });
const cp = (from, to) => fs.cpSync(path.join(root, from), path.join(root, to), { recursive: true, verbatimSymlinks: true });

console.log("1/4 Building the app server");
rm(".next");
run("npx next build", { NEXT_TELEMETRY_DISABLED: "1" });

console.log("2/4 Bundling the server");
rm("dist-app");
cp(".next/standalone", "dist-app/server");
cp(".next/static", "dist-app/server/.next/static");
if (fs.existsSync(path.join(root, "public"))) cp("public", "dist-app/server/public");
// Make sure the SQLite driver ships complete, with its prebuilt binaries.
rm("dist-app/server/node_modules/better-sqlite3");
cp("node_modules/better-sqlite3", "dist-app/server/node_modules/better-sqlite3");
// Never ship personal files or local databases inside the server folder.
for (const p of ["data", "private", "evidence", "backups"]) rm(`dist-app/server/${p}`);
for (const f of fs.readdirSync(path.join(root, "dist-app/server"))) {
  if (/\.(pdf|db|db-wal|db-shm)$/i.test(f)) rm(`dist-app/server/${f}`);
}
cp("drizzle", "dist-app/drizzle");
if (fs.existsSync(path.join(root, "private/timetable.json"))) {
  cp("private/timetable.json", "dist-app/timetable.json");
  console.log("   Included your private timetable (stays on this Mac, never in git).");
}
// The Apple Calendar helper needs macOS and the Swift compiler (Xcode command line tools).
if (process.platform === "darwin") {
  fs.mkdirSync(path.join(root, "dist-app/bin"), { recursive: true });
  try {
    run(`swiftc -O -swift-version 5 native/calendar-sync.swift -o dist-app/bin/ascend-calendar`);
    run(`codesign --force --sign - dist-app/bin/ascend-calendar`);
    console.log("   Built the Apple Calendar helper.");
  } catch {
    console.warn("   Skipped the Apple Calendar helper: install the command line tools with xcode-select --install, then package again.");
  }
}
if (fs.existsSync(path.join(root, "private/starting-record.json"))) {
  cp("private/starting-record.json", "dist-app/starting-record.json");
  console.log("   Included your private starting record (stays on this Mac, never in git).");
}

if (process.argv.includes("--server-only")) {
  console.log("Server bundle ready in dist-app (skipping the app packaging).");
  process.exit(0);
}

console.log("3/4 Packaging ASCEND.app");
rm("release");
run("npx electron-builder --mac dir --arm64 --publish never");

const appPath = path.join(root, "release", "mac-arm64", "ASCEND.app");
if (process.platform === "darwin" && fs.existsSync(appPath)) {
  console.log("4/4 Signing for this Mac (ad-hoc)");
  run(`codesign --force --deep --sign - "${appPath}"`);
}
console.log(`\nDone: ${appPath}\nDrag ASCEND.app into Applications, then open it.`);
