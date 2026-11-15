/**
 * Quick-entry parser: "piano 30", "tennis 1h30 hard", "90m maths past paper".
 * Deterministic, no AI. Finds a duration, an optional difficulty and the
 * template or skill the words refer to. Leftover words become notes.
 */
import type { Difficulty } from "./types";

export interface Candidate {
  kind: "template" | "skill";
  id: string;
  name: string;
  aliases: string[];
}

export interface ParsedEntry {
  durationMin: number | null;
  difficulty: Difficulty | null;
  match: Candidate | null;
  notes: string | null;
  /** The words used to find the match. */
  query: string;
}

const DIFFICULTY_WORDS: [string[], Difficulty][] = [
  [["very", "easy"], "very_easy"],
  [["very", "hard"], "very_hard"],
  [["easy"], "easy"],
  [["normal"], "normal"],
  [["hard"], "hard"],
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Reads a duration token. Returns minutes, or null if the token isn't a duration. */
export function parseDurationToken(token: string, next?: string): { minutes: number; consumed: number } | null {
  const t = token.toLowerCase();
  let m = /^(\d+)h(?:(\d+)(?:m|min)?)?$/.exec(t);
  if (m) return { minutes: Number(m[1]) * 60 + Number(m[2] ?? 0), consumed: 1 };
  m = /^(\d+(?:\.\d+)?)(?:h|hr|hrs|hour|hours)$/.exec(t);
  if (m) return { minutes: Math.round(Number(m[1]) * 60), consumed: 1 };
  m = /^(\d+)(?:m|min|mins|minute|minutes)$/.exec(t);
  if (m) return { minutes: Number(m[1]), consumed: 1 };
  m = /^(\d+(?:\.\d+)?)$/.exec(t);
  if (m) {
    const n = Number(m[1]);
    const unit = next?.toLowerCase();
    if (unit && /^(h|hr|hrs|hour|hours)$/.test(unit)) return { minutes: Math.round(n * 60), consumed: 2 };
    if (unit && /^(m|min|mins|minute|minutes)$/.test(unit)) return { minutes: Math.round(n), consumed: 2 };
    return { minutes: Math.round(n), consumed: 1 };
  }
  return null;
}

function matchLength(words: string[], phrase: string[]): number {
  if (phrase.length === 0 || phrase.length > words.length) return 0;
  for (let i = 0; i < phrase.length; i++) if (words[i] !== phrase[i]) return 0;
  return phrase.length;
}

export function parseQuickEntry(input: string, candidates: Candidate[]): ParsedEntry {
  const raw = input.trim().split(/\s+/).filter(Boolean);
  let durationMin: number | null = null;
  let difficulty: Difficulty | null = null;
  const rest: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const tok = raw[i]!;
    if (durationMin === null) {
      const d = parseDurationToken(tok, raw[i + 1]);
      if (d) {
        durationMin = d.minutes;
        i += d.consumed - 1;
        continue;
      }
    }
    if (difficulty === null) {
      const lower = raw.slice(i, i + 2).map((w) => w.toLowerCase());
      const hit = DIFFICULTY_WORDS.find(([words]) => words.every((w, k) => lower[k] === w));
      if (hit) {
        difficulty = hit[1];
        i += hit[0].length - 1;
        continue;
      }
    }
    rest.push(tok);
  }

  const words = norm(rest.join(" "));
  let best: { c: Candidate; len: number; start: number; score: number } | null = null;
  for (const c of candidates) {
    for (const phrase of [c.name, ...c.aliases].map(norm)) {
      for (let start = 0; start < words.length; start++) {
        const len = matchLength(words.slice(start), phrase);
        if (!len) continue;
        // Prefer longer phrases, matches at the start, and templates over skills.
        const score = len * 10 - start * 3 + (c.kind === "template" ? 1 : 0);
        if (!best || score > best.score) best = { c, len, start, score };
      }
    }
  }
  if (!best && words.length) {
    // Fall back to a prefix match on the first word ("math" -> "Mathematics").
    const first = words[0]!;
    if (first.length >= 3) {
      for (const c of candidates) {
        const names = [c.name, ...c.aliases].map((n) => norm(n).join(" "));
        if (names.some((n) => n.startsWith(first))) {
          const score = c.kind === "template" ? 1 : 0;
          if (!best || score > best.score) best = { c, len: 1, start: 0, score };
        }
      }
    }
  }

  const leftover = best ? [...words.slice(0, best.start), ...words.slice(best.start + best.len)] : words;
  return {
    durationMin,
    difficulty,
    match: best?.c ?? null,
    notes: best && leftover.length ? leftover.join(" ") : null,
    query: words.join(" "),
  };
}
