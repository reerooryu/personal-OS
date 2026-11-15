/** The current time for a server render. Pages are rendered per request, so this is intentional. */
export function requestTime(): number {
  return Date.now();
}
