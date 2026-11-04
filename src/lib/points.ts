/**
 * Series points. Phase 1 has the per-place lookup the seed script uses; the
 * standings engine (drop-worst-N and tiebreakers) is built in phase 5.
 */
export type PointsTable = Record<string, number>;
export type ResultStatus = "finished" | "DNF" | "DNS" | "DQ";

export const DEFAULT_POINTS_TABLE: PointsTable = {
  "1": 25, "2": 20, "3": 16, "4": 13, "5": 11, "6": 10, "7": 9, "8": 8,
  "9": 7, "10": 6, "11": 5, "12": 4, "13": 3, "14": 2, "15": 1,
};

/** DNF, DNS, and DQ score zero. Places past the table score zero. */
export function pointsForResult(table: PointsTable, place: number | null, status: ResultStatus): number {
  if (status !== "finished" || place == null || place < 1) return 0;
  return table[String(place)] ?? 0;
}
