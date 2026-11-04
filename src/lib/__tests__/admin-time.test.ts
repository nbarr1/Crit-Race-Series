import { describe, expect, it } from "vitest";
import { centsToDollars, easternLocalToUtc, parseDollars, utcToEasternLocal } from "@/lib/time";

describe("Eastern wall-clock conversion for admin forms", () => {
  it("converts summer (EDT) and winter (EST) times", () => {
    expect(easternLocalToUtc("2027-05-12T17:15")).toBe("2027-05-12T21:15:00.000Z");
    expect(easternLocalToUtc("2027-12-01T17:15")).toBe("2027-12-01T22:15:00.000Z");
  });

  it("handles the days the clocks change", () => {
    // November 7, 2027: 1:30 AM happens twice; either reading is an hour apart.
    expect(easternLocalToUtc("2027-11-07T12:00")).toBe("2027-11-07T17:00:00.000Z");
    expect(easternLocalToUtc("2027-03-14T12:00")).toBe("2027-03-14T16:00:00.000Z");
    // 2:30 AM on March 14, 2027 doesn't exist; it resolves to 1:30 AM EST, an hour off.
    expect(easternLocalToUtc("2027-03-14T02:30")).toBe("2027-03-14T06:30:00.000Z");
  });

  it("rejects malformed and impossible values", () => {
    expect(easternLocalToUtc("")).toBeNull();
    expect(easternLocalToUtc("2027-02-30T10:00")).toBeNull();
    expect(easternLocalToUtc("2027-05-12 17:15")).toBeNull();
    expect(easternLocalToUtc("2027-05-12T24:00")).toBeNull();
  });

  it("round-trips through a datetime-local value", () => {
    expect(utcToEasternLocal("2027-05-12T21:15:00Z")).toBe("2027-05-12T17:15");
    expect(utcToEasternLocal("2027-12-01T22:15:00+00:00")).toBe("2027-12-01T17:15");
    for (const v of ["2027-01-05T08:00", "2027-07-04T23:59", "2027-11-07T03:00"]) {
      expect(utcToEasternLocal(easternLocalToUtc(v)!)).toBe(v);
    }
  });
});

describe("dollar inputs", () => {
  it("parses dollars to cents", () => {
    expect(parseDollars("25")).toBe(2500);
    expect(parseDollars("$25.5")).toBe(2550);
    expect(parseDollars(" 1,200.05 ")).toBe(120005);
    expect(parseDollars("0")).toBe(0);
  });

  it("rejects anything else", () => {
    expect(parseDollars("")).toBeNull();
    expect(parseDollars("-5")).toBeNull();
    expect(parseDollars("25.555")).toBeNull();
    expect(parseDollars("free")).toBeNull();
  });

  it("formats cents for an input", () => {
    expect(centsToDollars(2500)).toBe("25");
    expect(centsToDollars(2550)).toBe("25.50");
  });
});
