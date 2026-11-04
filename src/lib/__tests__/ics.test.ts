import { describe, expect, it } from "vitest";
import { buildCalendar, escapeText, foldLine } from "@/lib/ics";

describe("ics", () => {
  const event = {
    uid: "e1@conestee-crit",
    start: new Date("2027-05-12T21:15:00Z"),
    end: new Date("2027-05-13T00:25:00Z"),
    summary: "Race 1",
    location: "Conestee Nature Park, Brevard, NC",
    description: "Races: B 5:15 PM; A 7:35 PM\nDetails online.",
    url: "https://crit.example/events/e1",
  };

  it("writes a valid calendar with UTC times and CRLF line endings", () => {
    const ics = buildCalendar("Conestee Crit Series", [event], new Date("2026-11-04T12:00:00Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20270512T211500Z");
    expect(ics).toContain("DTEND:20270513T002500Z");
    expect(ics).toContain("DTSTAMP:20261104T120000Z");
    expect(ics).toContain("LOCATION:Conestee Nature Park\\, Brevard\\, NC");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  it("marks canceled events", () => {
    const ics = buildCalendar("x", [{ ...event, canceled: true }]);
    expect(ics).toContain("SUMMARY:Canceled: Race 1");
    expect(ics).toContain("STATUS:CANCELLED");
  });

  it("escapes text and folds long lines at 75 octets", () => {
    expect(escapeText("a;b,c\\d\ne")).toBe("a\;b\\,c\\\\d\\ne");
    const long = `DESCRIPTION:${"é".repeat(60)}`;
    const folded = foldLine(long);
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").slice(1).every((l) => l.startsWith(" "))).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });
});
