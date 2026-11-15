import { localParts, localToUtc } from "@/domain/time";

export const APP_TZ = "Asia/Bangkok";
const pad = (n: number) => String(n).padStart(2, "0");

/** UTC ms -> "YYYY-MM-DDTHH:mm" in the app's time zone, for datetime-local inputs. */
export function toLocalInput(ms: number, tz = APP_TZ): string {
  const p = localParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function fromLocalInput(value: string, tz = APP_TZ): number {
  const [d, t] = value.split("T");
  const [y, m, day] = (d ?? "").split("-").map(Number);
  const [h, min] = (t ?? "00:00").split(":").map(Number);
  return localToUtc(tz, y!, m!, day!, h ?? 0, min ?? 0);
}

export function toLocalDate(ms: number, tz = APP_TZ): string {
  return toLocalInput(ms, tz).slice(0, 10);
}

export function fromLocalDate(value: string, tz = APP_TZ): number {
  return fromLocalInput(`${value}T12:00`, tz);
}
