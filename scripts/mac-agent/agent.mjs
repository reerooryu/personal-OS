/**
 * ASCEND Mac helper.
 *
 * Runs on the Mac under launchd (see install.sh). Claude can only write files
 * into this folder, so it asks for work by dropping a request in
 * .sync/agent/requests/<id>.json. The helper runs only the actions below, never
 * an arbitrary command, and it never pushes to GitHub: that stays with you.
 *
 *   snapshot  copy the live database to .sync/agent/out/ascend.db (for analysis)
 *   deploy    remove files, npm install if needed, test, build, install the app,
 *             relaunch it, and commit. Stops at the first failure.
 *   status    versions, git state, app location
 *   cleanup   delete old hand-off files and private/ascend-copy.db
 *
 * Each request gets .sync/agent/results/<id>.json and logs/<id>.log.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION = 1;
const REPO = process.env.ASCEND_REPO || path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const APP = process.env.ASCEND_APP || "/Applications/ASCEND.app";
const DB = path.join(os.homedir(), "Library/Application Support/ASCEND/ascend.db");
const BACKUPS = path.join(os.homedir(), "Library/Application Support/ASCEND/backups");
const BASE = path.join(REPO, ".sync/agent");
const dir = (d) => fs.mkdirSync(path.join(BASE, d), { recursive: true });
for (const d of ["requests", "results", "logs", "out", "done"]) dir(d);

const TRAILERS = "\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01DsfZfeijZMNnDFDvoTNehY";
/** Never committed, whatever .gitignore says. The repo is public. */
const FORBIDDEN = [/^private\//, /^evidence\//, /^data\//, /^backups\//, /^\.sync\//, /^release\//, /^dist-app\//, /\.pdf$/i, /\.db(-wal|-shm|-journal)?$/i, /(^|\/)\.env/];

// ------------------------------------------------------------------ lock ---
const LOCK = path.join(BASE, "agent.lock");
try {
  const fd = fs.openSync(LOCK, "wx");
  fs.writeSync(fd, String(process.pid));
  fs.closeSync(fd);
} catch {
  const pid = Number(fs.readFileSync(LOCK, "utf8"));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {}
  if (alive) process.exit(0);
  fs.writeFileSync(LOCK, String(process.pid));
}
const unlock = () => fs.rmSync(LOCK, { force: true });
process.on("exit", unlock);

// --------------------------------------------------------------- helpers ---
let logFile = null;
const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(" ")}\n`;
  if (logFile) fs.appendFileSync(logFile, line);
  process.stdout.write(line);
};

/** Runs a program (no shell) in the repo; throws with the tail of its output on failure. */
function run(cmd, args, { timeoutMin = 20, env = {} } = {}) {
  log("$", cmd, ...args);
  const r = spawnSync(cmd, args, { cwd: REPO, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", CI: "1", ...env }, timeout: timeoutMin * 60_000, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (logFile) fs.appendFileSync(logFile, out);
  if (r.status !== 0) {
    const tail = out.split("\n").filter(Boolean).slice(-40).join("\n");
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.error?.message ?? `exit ${r.status}`})\n${tail}`);
  }
  return out;
}

const git = (...a) => run("git", a).trim();
const sha = (f) => (fs.existsSync(f) ? createHash("sha1").update(fs.readFileSync(f)).digest("hex") : null);
const STATE = path.join(BASE, "state.json");
const state = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {});
const saveState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));

/** A path inside the repo, given relative to it, with no way out. */
function inside(rel) {
  if (typeof rel !== "string" || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) throw new Error(`Bad path: ${rel}`);
  return path.join(REPO, rel);
}

function snapshotTo(file) {
  if (!fs.existsSync(DB)) throw new Error(`No database at ${DB}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  execFileSync("/usr/bin/sqlite3", [DB, `.backup '${file.replaceAll("'", "''")}'`]);
  return { file: path.relative(REPO, file), bytes: fs.statSync(file).size };
}

function appRunning() {
  return spawnSync("/usr/bin/pgrep", ["-f", `${APP}/Contents/MacOS/`]).status === 0;
}

function quitApp() {
  if (!appRunning()) return false;
  spawnSync("/usr/bin/pkill", ["-TERM", "-f", `${APP}/Contents/MacOS/`]);
  for (let i = 0; i < 40 && appRunning(); i++) spawnSync("/bin/sleep", ["0.25"]);
  if (appRunning() || spawnSync("/usr/bin/pgrep", ["-f", `${APP}/Contents/`]).status === 0) {
    spawnSync("/usr/bin/pkill", ["-KILL", "-f", `${APP}/Contents/`]);
    spawnSync("/bin/sleep", ["1"]);
  }
  return true;
}

function notify(title, text) {
  spawnSync("/usr/bin/osascript", ["-e", `display notification ${JSON.stringify(text)} with title ${JSON.stringify(title)}`]);
}

// --------------------------------------------------------------- actions ---
const actions = {
  status() {
    return {
      agentVersion: VERSION,
      node: process.version,
      npm: run("npm", ["-v"]).trim(),
      head: git("log", "--oneline", "-1"),
      changes: git("status", "--short").split("\n").filter(Boolean),
      ahead: (() => {
        try {
          return Number(git("rev-list", "--count", "@{u}..HEAD"));
        } catch {
          return null;
        }
      })(),
      app: APP,
      appInstalled: fs.existsSync(APP),
      appBuilt: fs.existsSync(APP) ? fs.statSync(APP).mtime.toISOString() : null,
      appRunning: appRunning(),
      database: fs.existsSync(DB) ? fs.statSync(DB).size : null,
    };
  },

  snapshot() {
    return snapshotTo(path.join(BASE, "out/ascend.db"));
  },

  cleanup() {
    const removed = [];
    const rm = (p) => {
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
        removed.push(path.relative(REPO, p));
      }
    };
    for (const e of fs.readdirSync(path.join(REPO, ".sync"))) if (e !== "agent") rm(path.join(REPO, ".sync", e));
    rm(path.join(REPO, "private/ascend-copy.db"));
    rm(path.join(BASE, "out/ascend.db"));
    const old = Date.now() - 14 * 86_400_000;
    for (const d of ["results", "logs", "done"])
      for (const f of fs.readdirSync(path.join(BASE, d))) {
        const p = path.join(BASE, d, f);
        if (fs.statSync(p).mtimeMs < old) rm(p);
      }
    return { removed };
  },

  /**
   * { message, remove?: string[], install?: boolean (default true) }
   * Stops at the first failing step. Nothing is installed unless the tests pass.
   */
  deploy(req) {
    const steps = [];
    const step = (name, fn) => {
      const t = Date.now();
      log(`== ${name}`);
      const r = fn();
      steps.push({ name, sec: Math.round((Date.now() - t) / 1000) });
      return r;
    };
    if (typeof req.message !== "string" || !req.message.trim() || req.message.length > 2000) throw new Error("deploy needs a commit message");
    const install = req.install !== false;

    step("remove files", () => {
      for (const rel of req.remove ?? []) {
        const p = inside(rel);
        const tracked = spawnSync("git", ["ls-files", "--error-unmatch", rel], { cwd: REPO }).status === 0;
        if (tracked) git("rm", "-q", "-r", "--", rel);
        else fs.rmSync(p, { recursive: true, force: true });
      }
    });

    step("dependencies", () => {
      const s = state();
      const lock = sha(path.join(REPO, "package-lock.json"));
      if (!fs.existsSync(path.join(REPO, "node_modules")) || s.lockHash !== lock) {
        run("npm", ["install", "--no-audit", "--no-fund"]);
        saveState({ ...state(), lockHash: lock });
      }
    });

    step("typecheck", () => run("npx", ["tsc", "--noEmit"]));
    const tests = step("tests", () => run("npm", ["test"]));
    const plain = tests.replace(/\x1b\[[0-9;]*m/g, "");
    const summary = (plain.match(/Tests\s+(\d+ passed[^\n]*)/) ?? [])[1]?.trim() ?? null;

    let backup = null;
    if (install) {
      backup = step("database backup", () => (fs.existsSync(DB) ? snapshotTo(path.join(BACKUPS, `pre-update-${new Date().toISOString().replace(/[:.]/g, "-")}.db`)).file : null));
      step("build", () => run("npm", ["run", "package"], { timeoutMin: 30 }));
      const built = path.join(REPO, "release/mac-arm64/ASCEND.app");
      if (!fs.existsSync(built)) throw new Error("The build finished but release/mac-arm64/ASCEND.app is missing");
      step("install", () => {
        const wasRunning = quitApp();
        const old = `${APP}.previous`;
        fs.rmSync(old, { recursive: true, force: true });
        if (fs.existsSync(APP)) fs.renameSync(APP, old);
        try {
          execFileSync("/usr/bin/ditto", [built, APP]);
        } catch (e) {
          if (fs.existsSync(old)) fs.renameSync(old, APP);
          throw e;
        }
        fs.rmSync(old, { recursive: true, force: true });
        execFileSync("/usr/bin/open", [APP]);
        return wasRunning;
      });
    }

    const commit = step("commit", () => {
      git("add", "-A");
      const staged = git("diff", "--cached", "--name-only").split("\n").filter(Boolean);
      const bad = staged.filter((f) => FORBIDDEN.some((re) => re.test(f)));
      if (bad.length) {
        git("reset", "-q");
        throw new Error(`Refused to commit private files: ${bad.join(", ")}`);
      }
      if (!staged.length) return null;
      git("commit", "-q", "-m", req.message.trim() + TRAILERS);
      return { sha: git("rev-parse", "--short", "HEAD"), files: staged.length };
    });

    notify(install ? "ASCEND updated" : "ASCEND checked", commit ? `Committed ${commit.sha}. Push when you're ready.` : "Nothing new to commit.");
    return { steps, tests: summary, backup, commit, installed: install };
  },
};

// ------------------------------------------------------------------ main ---
/** Quick requests first, so a status check never waits behind a build. */
const PRIORITY = { status: 0, snapshot: 1, cleanup: 2, deploy: 3 };
const skipped = new Set();
function next() {
  const reqs = [];
  for (const f of fs.readdirSync(path.join(BASE, "requests")).filter((x) => x.endsWith(".json") && !skipped.has(x))) {
    try {
      reqs.push({ f, req: JSON.parse(fs.readFileSync(path.join(BASE, "requests", f), "utf8")) });
    } catch {
      skipped.add(f); // still being written: the next run picks it up
    }
  }
  reqs.sort((a, b) => (PRIORITY[a.req.action] ?? 9) - (PRIORITY[b.req.action] ?? 9) || a.f.localeCompare(b.f));
  return reqs[0];
}

for (let item = next(); item; item = next()) {
  const { f, req } = item;
  const src = path.join(BASE, "requests", f);
  const id = String(req.id || f.replace(/\.json$/, "")).replace(/[^\w.-]/g, "_");
  fs.renameSync(src, path.join(BASE, "done", `${id}.json`));
  logFile = path.join(BASE, "logs", `${id}.log`);
  fs.writeFileSync(path.join(BASE, "results", `${id}.json`), JSON.stringify({ id, action: req.action, state: "running", startedAt: new Date().toISOString() }, null, 2));
  const started = Date.now();
  let result;
  try {
    const fn = Object.hasOwn(actions, req.action) ? actions[req.action] : null;
    if (!fn) throw new Error(`Unknown action: ${req.action}`);
    result = { id, action: req.action, state: "ok", ...{ result: fn(req) } };
  } catch (e) {
    log("FAILED:", e.message);
    result = { id, action: req.action, state: "failed", error: String(e.message).slice(0, 8000) };
    if (req.action === "deploy") notify("ASCEND update stopped", String(e.message).split("\n")[0].slice(0, 200));
  }
  result.sec = Math.round((Date.now() - started) / 1000);
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(BASE, "results", `${id}.json`), JSON.stringify(result, null, 2));
  log(`${id}: ${result.state} in ${result.sec}s`);
  logFile = null;
}
