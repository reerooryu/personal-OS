/**
 * Browser side of the usage log. Queues events and sends them in small
 * batches. Callers pass labels and numbers, never what someone typed.
 */
type Kind = "view" | "click" | "select" | "edit" | "submit" | "open" | "save" | "abandon" | "error" | "warning";
type Meta = Record<string, string | number | boolean>;

interface Event {
  at: number;
  sessionId: string;
  kind: Kind;
  name: string;
  path: string | null;
  ms: number | null;
  meta: Meta | null;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Turns /activities/3f2c…/edit into /activities/:id/edit so pages group together. */
export function routeOf(path: string): string {
  return path.split("?")[0]!.replace(UUID, ":id").replace(/\/\d+(?=\/|$)/g, "/:n") || "/";
}

let queue: Event[] = [];
let timer: number | null = null;
let sessionId = "";

function session(): string {
  if (!sessionId) sessionId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  return sessionId;
}

export function track(kind: Kind, name: string, extra: { ms?: number; meta?: Meta } = {}): void {
  if (typeof window === "undefined") return;
  queue.push({
    at: Date.now(),
    sessionId: session(),
    kind,
    name: name.replace(/\s+/g, " ").trim().slice(0, 80) || "(unnamed)",
    path: routeOf(window.location.pathname),
    ms: extra.ms == null ? null : Math.max(0, Math.round(extra.ms)),
    meta: extra.meta ?? null,
  });
  if (queue.length >= 50) flushUsage();
  else if (timer === null) timer = window.setTimeout(flushUsage, 4000);
}

/** Sends what's queued. `beacon` is for page unload, when fetch may be cut off. */
export function flushUsage(beacon = false): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (!queue.length) return;
  const body = JSON.stringify({ events: queue });
  queue = [];
  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon("/api/usage", new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch("/api/usage", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {
    /* the usage log must never get in the way */
  });
}
