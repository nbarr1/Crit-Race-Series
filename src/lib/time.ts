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
