/** Only allow same-site relative redirect targets (blocks open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/my-races"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
