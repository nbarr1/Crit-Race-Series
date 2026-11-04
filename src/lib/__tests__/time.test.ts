import { describe, expect, it } from "vitest";
import { ageOn, formatCents, formatEventDate, formatTime, racingAge, todayInDisplayTz } from "@/lib/time";

describe("time helpers", () => {
  it("formats a date-only value without shifting the day", () => {
    expect(formatEventDate("2027-05-12")).toBe("Wednesday, May 12, 2027");
    expect(formatEventDate("2027-05-12", "short")).toBe("Wed, May 12");
  });

  it("shows UTC timestamps in Eastern Time (EDT in summer)", () => {
    // 22:00 UTC on a summer date is 6:00 PM EDT.
    expect(formatTime("2027-06-02T22:00:00Z")).toBe("6:00 PM");
  });

  it("works out today's date in Eastern Time", () => {
    // 02:30 UTC on June 3 is still June 2 in New York.
    expect(todayInDisplayTz(new Date("2027-06-03T02:30:00Z"))).toBe("2027-06-02");
  });

  it("computes age on a date", () => {
    expect(ageOn("2009-06-15", "2027-06-14")).toBe(17);
    expect(ageOn("2009-06-15", "2027-06-15")).toBe(18);
  });

  it("computes racing age as of December 31", () => {
    expect(racingAge("1987-11-30", 2027)).toBe(40);
  });

  it("formats cents as dollars", () => {
    expect(formatCents(2500)).toBe("$25.00");
  });
});
