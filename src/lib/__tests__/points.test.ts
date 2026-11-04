import { describe, expect, it } from "vitest";
import {
  DEFAULT_POINTS_TABLE,
  computeStandings,
  countedRaces,
  parsePointsTable,
  pointsForResult,
  type ResultStatus,
  type ScoredResult,
} from "@/lib/points";

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

  it("scores a missing or invalid place as zero", () => {
    expect(pointsForResult(DEFAULT_POINTS_TABLE, null, "finished")).toBe(0);
    expect(pointsForResult(DEFAULT_POINTS_TABLE, 0, "finished")).toBe(0);
    expect(pointsForResult({ "1": -5 }, 1, "finished")).toBe(0);
  });

  it("drops by one point from 6th to 15th", () => {
    for (let p = 6; p < 15; p++) {
      expect(DEFAULT_POINTS_TABLE[String(p)] - DEFAULT_POINTS_TABLE[String(p + 1)]).toBe(1);
    }
  });
});

describe("parsePointsTable", () => {
  it("keeps whole-number places with non-negative points", () => {
    expect(parsePointsTable({ "1": 25, "2": "20", x: 5, "0": 3, "3": -1 })).toEqual({ "1": 25, "2": 20 });
    expect(parsePointsTable(null)).toEqual({});
    expect(parsePointsTable([1, 2])).toEqual({});
  });
});

describe("countedRaces", () => {
  it("counts every race when nothing is dropped", () => {
    expect(countedRaces(5, 0)).toBe(5);
  });
  it("counts the best E - N races", () => {
    expect(countedRaces(10, 2)).toBe(8);
  });
  it("counts at least one race early in the season", () => {
    expect(countedRaces(1, 2)).toBe(1);
    expect(countedRaces(2, 2)).toBe(1);
    expect(countedRaces(0, 2)).toBe(0);
  });
});

/** Builds results from a compact table: rider -> place per event (null = absent, string = status). */
function season(grid: Record<string, (number | ResultStatus | null)[]>, table = DEFAULT_POINTS_TABLE): ScoredResult[] {
  const out: ScoredResult[] = [];
  for (const [riderId, cells] of Object.entries(grid)) {
    cells.forEach((cell, i) => {
      if (cell === null) return;
      const status: ResultStatus = typeof cell === "number" ? "finished" : cell;
      const place = typeof cell === "number" ? cell : null;
      out.push({
        riderId,
        eventId: `e${i + 1}`,
        eventDate: `2027-06-${String(i + 1).padStart(2, "0")}`,
        place,
        status,
        points: pointsForResult(table, place, status),
      });
    });
  }
  return out;
}

const byRider = (rows: ReturnType<typeof computeStandings>) => Object.fromEntries(rows.map((r) => [r.riderId, r]));

describe("computeStandings", () => {
  it("returns nothing for no results", () => {
    expect(computeStandings([])).toEqual([]);
  });

  it("sums points and orders riders by total", () => {
    const rows = computeStandings(season({ cam: [3, 3], ana: [1, 4], ben: [2, 2] }));
    expect(rows.map((r) => [r.riderId, r.totalPoints])).toEqual([
      ["ben", 40],
      ["ana", 38],
      ["cam", 32],
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows[1]).toMatchObject({ riderId: "ana", races: 2, wins: 1, tied: false });
  });

  it("breaks a points tie on wins", () => {
    // ana: 25 + 0 + 0 = 25. ben: 13 + 11 + 1 = 25 with no wins.
    const rows = computeStandings(season({ ana: [1, "DNF", null], ben: [4, 5, 15] }));
    expect(rows.map((r) => r.riderId)).toEqual(["ana", "ben"]);
    expect(rows[0]).toMatchObject({ totalPoints: 25, wins: 1, rank: 1, tied: false });
    expect(rows[1]).toMatchObject({ totalPoints: 25, wins: 0, rank: 2, tied: false });
  });

  it("then breaks it on the better place in the most recent race", () => {
    // Both have 45 and one win. ben beat ana in the last race.
    const rows = computeStandings(season({ ana: [1, 2], ben: [2, 1] }));
    expect(rows.map((r) => r.riderId)).toEqual(["ben", "ana"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("walks back to earlier races when the latest one doesn't separate them", () => {
    // Both have 25 + 16 and one win. Neither finished races 3 or 4, so race 2 decides.
    const rows = computeStandings(season({ ana: [1, 3, "DNF", "DNS"], ben: [3, 1, "DQ", "DNF"] }));
    // Race 4 and 3: neither finished. Race 2: ben won.
    expect(rows.map((r) => r.riderId)).toEqual(["ben", "ana"]);
  });

  it("ranks a finisher ahead of a non-finisher in the tiebreak race", () => {
    // Both score 10. In race 2, ana finished 20th (no points) and ben didn't finish.
    const table = { "1": 10, "2": 10 };
    const rows = computeStandings(season({ ana: [2, 20], ben: [2, "DNF"] }, table));
    expect(rows.map((r) => r.riderId)).toEqual(["ana", "ben"]);
  });

  it("shares a rank when every tiebreaker is level", () => {
    const rows = computeStandings(season({ ana: [1, 3], ben: [1, 3], cam: [2, 2], dee: [4, 4] }, { "1": 10, "2": 6, "3": 2, "4": 1 }));
    // Two riders can't share 1st in a real race, but the engine must still be stable if a sheet does.
    const r = byRider(rows);
    expect(r.ana.rank).toBe(1);
    expect(r.ben.rank).toBe(1);
    expect(r.ana.tied && r.ben.tied).toBe(true);
    expect(r.cam.rank).toBe(3);
    expect(r.cam.tied).toBe(false);
    expect(r.dee.rank).toBe(4);
  });

  it("drops each rider's worst results", () => {
    const results = season({ ana: [1, 10, 2], ben: [3, 3, 3] });
    const rows = byRider(computeStandings(results, { dropWorstN: 1 }));
    expect(rows.ana).toMatchObject({ totalPoints: 45, rawPoints: 51, races: 3 });
    expect(rows.ana.results.map((s) => s.dropped)).toEqual([false, true, false]);
    expect(rows.ben).toMatchObject({ totalPoints: 32, rawPoints: 48 });
  });

  it("counts a missed race as one of the drops", () => {
    // Three races, drop 1: ana missed race 2, so all her results count.
    const rows = byRider(computeStandings(season({ ana: [5, null, 5], ben: [1, 1, 1] }), { dropWorstN: 1 }));
    expect(rows.ana).toMatchObject({ totalPoints: 22, rawPoints: 22, races: 2 });
    expect(rows.ana.results.every((s) => !s.dropped)).toBe(true);
    expect(rows.ben.totalPoints).toBe(50);
  });

  it("drops the oldest of equal scores", () => {
    const rows = byRider(computeStandings(season({ ana: [5, 5, 1] }), { dropWorstN: 1 }));
    expect(rows.ana.results.map((s) => [s.eventId, s.dropped])).toEqual([
      ["e1", true],
      ["e2", false],
      ["e3", false],
    ]);
  });

  it("keeps each rider's best result when there are no more races than drops", () => {
    const rows = byRider(computeStandings(season({ ana: [3, 1], ben: [2, null] }), { dropWorstN: 2 }));
    expect(rows.ana.totalPoints).toBe(25);
    expect(rows.ben.totalPoints).toBe(20);
  });

  it("ranks on totals after drops, not raw points", () => {
    // Raw: ana 25+25+0 = 50, ben 20+20+20 = 60. Drop 1: ana 50, ben 40.
    const rows = computeStandings(season({ ana: [1, 1, "DNS"], ben: [2, 2, 2] }), { dropWorstN: 1 });
    expect(rows.map((r) => [r.riderId, r.totalPoints])).toEqual([
      ["ana", 50],
      ["ben", 40],
    ]);
  });

  it("does not count a DQ'd or DNF place as a win", () => {
    const rows = byRider(computeStandings([
      { riderId: "ana", eventId: "e1", eventDate: "2027-06-01", place: 1, status: "DQ", points: 0 },
    ]));
    expect(rows.ana.wins).toBe(0);
  });

  it("lists each rider's results oldest first", () => {
    const rows = byRider(computeStandings(season({ ana: [1, 2, 3] }).reverse()));
    expect(rows.ana.results.map((s) => s.eventId)).toEqual(["e1", "e2", "e3"]);
  });
});
