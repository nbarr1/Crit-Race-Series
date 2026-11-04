/**
 * Series points and standings (DECISIONS.md D-100 to D-103).
 *
 * The database stores points per result (computed from the season's points
 * table when results are saved and published). This module turns published
 * results into ranked standings: drop-worst-N, then the tiebreakers. The
 * `standings` view in the database applies the same drop rule, and the SQL
 * tests check that the two agree.
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
  const p = table[String(place)];
  return typeof p === "number" && Number.isFinite(p) && p > 0 ? Math.floor(p) : 0;
}

/** One published result in one category. */
export interface ScoredResult {
  riderId: string;
  eventId: string;
  /** YYYY-MM-DD. Used to order events and to break ties. */
  eventDate: string;
  place: number | null;
  status: ResultStatus;
  points: number;
}

export interface EventScore {
  eventId: string;
  points: number;
  place: number | null;
  status: ResultStatus;
  /** True when drop-worst-N leaves this result out of the total. */
  dropped: boolean;
}

export interface StandingRow {
  riderId: string;
  /** Competition ranking: riders still tied after every tiebreaker share a rank (1, 2, 2, 4). */
  rank: number;
  /** True when another rider has the same rank. */
  tied: boolean;
  totalPoints: number;
  /** Points before drops. */
  rawPoints: number;
  races: number;
  wins: number;
  /** In event order (oldest first). */
  results: EventScore[];
}

/**
 * How many of a rider's results count toward the total. With N dropped
 * races and E events scored so far in the category, each rider's best E - N
 * results count. Missed races count as dropped first, because a rider has no
 * row for them. Early in the season, when E <= N, a rider's single best result
 * counts, so the table never reads all zeros (D-101).
 */
export function countedRaces(eventsScored: number, dropWorstN: number): number {
  if (eventsScored <= 0) return 0;
  if (dropWorstN <= 0) return eventsScored;
  return Math.max(eventsScored - dropWorstN, 1);
}

/** Lower is better. A rider without a finishing place at an event ranks after any finisher. */
function placeKey(r: ScoredResult | undefined): number {
  return r && r.status === "finished" && r.place != null ? r.place : Number.POSITIVE_INFINITY;
}

/**
 * Builds standings for one category from its published results.
 *
 * Order: total points (after drops), then most wins, then the better place in
 * the most recent event where the two riders' places differ, walking back one
 * event at a time (a finish beats a DNF, DNS, DQ, or no start). Riders still
 * level after that share a rank (D-102).
 */
export function computeStandings(results: ScoredResult[], opts: { dropWorstN?: number } = {}): StandingRow[] {
  const dropN = Math.max(0, Math.floor(opts.dropWorstN ?? 0));
  const eventDates = new Map<string, string>();
  for (const r of results) eventDates.set(r.eventId, r.eventDate);
  // Most recent first, for the tiebreaker. Same date: stable by event ID.
  const eventsNewestFirst = [...eventDates.entries()]
    .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : b[1].localeCompare(a[1])))
    .map(([id]) => id);
  const keep = countedRaces(eventDates.size, dropN);

  const byRider = new Map<string, Map<string, ScoredResult>>();
  for (const r of results) {
    let m = byRider.get(r.riderId);
    if (!m) byRider.set(r.riderId, (m = new Map()));
    // One result per rider per event in a category. Keep the higher-scoring one if the input repeats.
    const prev = m.get(r.eventId);
    if (!prev || r.points > prev.points) m.set(r.eventId, r);
  }

  const rows = [...byRider.entries()].map(([riderId, events]) => {
    const list = [...events.values()];
    // Same order as the view: points high to low, then most recent first, so
    // among equal scores the oldest is dropped.
    const ordered = [...list].sort((a, b) =>
      b.points !== a.points ? b.points - a.points : b.eventDate !== a.eventDate ? b.eventDate.localeCompare(a.eventDate) : a.eventId.localeCompare(b.eventId),
    );
    const counted = new Set(ordered.slice(0, keep).map((r) => r.eventId));
    const scores: EventScore[] = list
      .sort((a, b) => (a.eventDate === b.eventDate ? a.eventId.localeCompare(b.eventId) : a.eventDate.localeCompare(b.eventDate)))
      .map((r) => ({ eventId: r.eventId, points: r.points, place: r.place, status: r.status, dropped: !counted.has(r.eventId) }));
    return {
      riderId,
      rank: 0,
      tied: false,
      totalPoints: scores.filter((s) => !s.dropped).reduce((t, s) => t + s.points, 0),
      rawPoints: scores.reduce((t, s) => t + s.points, 0),
      races: scores.length,
      wins: scores.filter((s) => s.status === "finished" && s.place === 1).length,
      results: scores,
      events,
    };
  });

  const compare = (a: (typeof rows)[number], b: (typeof rows)[number]): number => {
    if (a.totalPoints !== b.totalPoints) return b.totalPoints - a.totalPoints;
    if (a.wins !== b.wins) return b.wins - a.wins;
    for (const ev of eventsNewestFirst) {
      const pa = placeKey(a.events.get(ev));
      const pb = placeKey(b.events.get(ev));
      if (pa !== pb) return pa - pb;
    }
    return 0;
  };

  rows.sort((a, b) => compare(a, b) || a.riderId.localeCompare(b.riderId));
  rows.forEach((row, i) => {
    row.rank = i > 0 && compare(rows[i - 1], row) === 0 ? rows[i - 1].rank : i + 1;
  });
  rows.forEach((row, i) => {
    row.tied = (i > 0 && rows[i - 1].rank === row.rank) || (i + 1 < rows.length && rows[i + 1].rank === row.rank);
  });
  return rows.map((row) => ({
    riderId: row.riderId,
    rank: row.rank,
    tied: row.tied,
    totalPoints: row.totalPoints,
    rawPoints: row.rawPoints,
    races: row.races,
    wins: row.wins,
    results: row.results,
  }));
}

/** Parses a points table from JSON (points_rules.points_by_place), ignoring bad entries. */
export function parsePointsTable(value: unknown): PointsTable {
  const out: PointsTable = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const place = Number(k);
    const pts = typeof v === "number" ? v : Number(v);
    if (Number.isInteger(place) && place > 0 && Number.isFinite(pts) && pts >= 0) out[String(place)] = Math.floor(pts);
  }
  return out;
}
