import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function minutesLabel(m: number): string {
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r ? `${h}h ${r}m` : `${h}h`;
}

const TZ = "Asia/Bangkok";
/** "Sat, Nov 14", with the year added when it isn't this year ("Sat, Feb 17, 2024"). */
export const dateLabel = (ms: number) => {
  const year = (d: number) => new Date(d).toLocaleDateString("en-US", { timeZone: TZ, year: "numeric" });
  const sameYear = year(ms) === year(Date.now());
  return new Date(ms).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
};
export const timeLabel = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
export const longDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });

export function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}
