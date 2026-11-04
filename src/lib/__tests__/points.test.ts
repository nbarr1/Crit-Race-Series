import { describe, expect, it } from "vitest";
import { DEFAULT_POINTS_TABLE, pointsForResult } from "@/lib/points";

describe("pointsForResult", () => {
  it("uses the default table from the series rules", () => {
    expect(pointsForResult(DEFAULT_POINTS_TABLE, 1, "finished")).toBe(25);
    expect(pointsForResult(DEFAULT_POINTS_TABLE, 6, "finished")).toBe(10);
    expect(pointsForResult(DEFAULT_POINTS_TABLE, 7, "finished")).toBe(9);
    expect(pointsForResult(DEFAULT_POINTS_TABLE, 15, "finished")).toBe(1);
    expect(pointsForResult(DEFAULT_POINTS_TABLE, 16, "finished")).toBe(0);
  });

  it("scores DNF, DNS, and DQ as zero", () => {
    for (const s of ["DNF", "DNS", "DQ"] as const) expect(pointsForResult(DEFAULT_POINTS_TABLE, 1, s)).toBe(0);
  });

  it("drops by one point from 6th to 15th", () => {
    for (let p = 6; p < 15; p++) {
      expect(DEFAULT_POINTS_TABLE[String(p)] - DEFAULT_POINTS_TABLE[String(p + 1)]).toBe(1);
    }
  });
});
