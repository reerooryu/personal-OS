import type { EventKind, Occurrence } from "@/services/calendar";

/** Colors on the week grid. Plain module so server and client components share it. */
export const STYLE: Record<Occurrence["kind"], string> = {
  lesson: "border-line bg-white/[0.035] text-muted",
  tutoring: "border-accent/40 bg-accent/15 text-ink",
  school: "border-good/40 bg-good/15 text-ink",
  duty: "border-warn/40 bg-warn/15 text-ink",
  event: "border-warn/50 bg-warn/20 text-ink",
  test: "border-bad/50 bg-bad/20 text-ink font-medium",
};

/** Ryu's own events, by what kind they are. */
export const EVENT_STYLE: Record<EventKind, string> = {
  competition: "border-gold/60 bg-gold/20 text-ink font-medium",
  event: "border-violet/50 bg-violet/20 text-ink",
  meetup: "border-sky/50 bg-sky/20 text-ink",
  friends: "border-pink/50 bg-pink/20 text-ink",
};

export const KIND_NAMES: Record<Occurrence["kind"], string> = {
  lesson: "Lesson",
  tutoring: "Tutoring",
  school: "School club (SOCS)",
  duty: "Duty",
  event: "Exam or school event",
  test: "Test",
};

export const EVENT_NAMES: Record<EventKind, string> = {
  competition: "Competition",
  event: "Formal event",
  meetup: "Meetup",
  friends: "Friends",
};

export const styleOf = (o: Occurrence) => (o.mine && o.category ? EVENT_STYLE[o.category] : STYLE[o.kind]);
export const nameOf = (o: Occurrence) => (o.mine && o.category ? EVENT_NAMES[o.category] : KIND_NAMES[o.kind]);
