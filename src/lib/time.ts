/** All times are stored in UTC and shown in the venue's time zone. */
export const DISPLAY_TZ = "America/New_York";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: DISPLAY_TZ,
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const shortDateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: DISPLAY_TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: DISPLAY_TZ,
  hour: "numeric",
  minute: "2-digit",
});

/** Formats a Postgres `date` (YYYY-MM-DD) without shifting it across time zones. */
export function formatEventDate(isoDate: string, style: "long" | "short" = "long"): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  // Noon UTC is the same calendar day in every US time zone.
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return (style === "long" ? dateFmt : shortDateFmt).format(date);
}

export function formatTime(iso: string | Date): string {
  return timeFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

export function formatDateTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${shortDateFmt.format(d)}, ${timeFmt.format(d)}`;
}

/** Today's date in the display time zone, as YYYY-MM-DD. */
export function todayInDisplayTz(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

/**
 * Age on a given date. Used for the under-18 guardian rule (age on race day)
 * and the Masters warning (age at December 31 of the season year, which is
 * the common racing-age convention).
 */
export function ageOn(birthDate: string, onDate: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = onDate.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

export function racingAge(birthDate: string, seasonYear: number): number {
  return seasonYear - Number(birthDate.slice(0, 4));
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/**
 * Current time for server components, which render once per request (the
 * page has already opted into request-time rendering through connection()).
 */
export function nowMs(): number {
  return Date.now();
}

/** Minutes the display time zone is ahead of UTC at an instant (negative in the US). */
function tzOffsetMinutes(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/**
 * A wall-clock time in the display time zone ("2027-05-12T17:15", as a
 * datetime-local input sends it) as a UTC ISO string. Returns null for
 * anything that isn't a valid date and time. A time skipped by the spring
 * clock change (2:00 to 2:59 AM) comes out an hour off, which no race uses.
 */
export function easternLocalToUtc(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(wall).getUTCDate() !== d) return null;
  let guess = wall - tzOffsetMinutes(wall) * 60_000;
  guess = wall - tzOffsetMinutes(guess) * 60_000;
  return new Date(guess).toISOString();
}

/** A UTC instant as a display-time-zone wall-clock value for a datetime-local input. */
export function utcToEasternLocal(iso: string): string {
  const ms = new Date(iso).getTime();
  const local = new Date(ms + tzOffsetMinutes(ms) * 60_000);
  return local.toISOString().slice(0, 16);
}

/** Parses a price typed in dollars ("25", "$25.50") into cents, or null. */
export function parseDollars(input: string): number | null {
  const s = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Cents as a plain dollar amount for an input ("25" or "25.50"). */
export function centsToDollars(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}
