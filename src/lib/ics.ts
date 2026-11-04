/**
 * iCalendar (RFC 5545) files for the schedule (section 5.5). Times are UTC
 * ("Z"), so every calendar app shows them in the reader's own time zone.
 */
export type CalendarEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location?: string;
  description?: string;
  url?: string;
  canceled?: boolean;
  updated?: Date;
};

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Escapes TEXT values: backslash, semicolon, comma, and newlines. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds content lines to 75 octets, continuing with CRLF and a space. */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + n > limit) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function buildCalendar(name: string, events: CalendarEvent[], now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Connestee Crit Series//Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(e.end)}`,
      `SUMMARY:${escapeText(e.canceled ? `Canceled: ${e.summary}` : e.summary)}`,
    );
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.updated) lines.push(`LAST-MODIFIED:${stamp(e.updated)}`);
    lines.push(`STATUS:${e.canceled ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export const ICS_HEADERS = (filename: string): HeadersInit => ({
  "content-type": "text/calendar; charset=utf-8",
  "content-disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
  "cache-control": "public, max-age=300",
});
