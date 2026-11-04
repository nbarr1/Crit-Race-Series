import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/env";
import { computeStandings, type ResultStatus, type StandingRow } from "@/lib/points";

/** Published results as the public sees them (the public_results view). */
export interface PublicResult {
  id: string;
  event_category_id: string;
  event_id: string;
  season_id: string;
  category_id: string;
  category_name: string;
  rider_id: string | null;
  display_name: string;
  team: string | null;
  place: number | null;
  status: ResultStatus;
  points_awarded: number;
}

const RESULT_COLUMNS =
  "id, event_category_id, event_id, season_id, category_id, category_name, rider_id, display_name, team, place, status, points_awarded";
const PAGE = 1000;

/** Reads every published result for a filter, a page at a time (PostgREST caps a response at 1,000 rows). */
async function allPublicResults(filter: { column: "season_id" | "event_id"; value: string }): Promise<PublicResult[]> {
  const supabase = createPublicClient();
  const out: PublicResult[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("public_results")
      .select(RESULT_COLUMNS)
      .eq(filter.column, filter.value)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as PublicResult[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Finishers by place, then DNF, DNS, and DQ, then by name. */
export function sortResults<T extends Pick<PublicResult, "place" | "status" | "display_name">>(rows: T[]): T[] {
  const statusOrder: Record<ResultStatus, number> = { finished: 0, DNF: 1, DNS: 2, DQ: 3 };
  return [...rows].sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] ||
      (a.place ?? 0) - (b.place ?? 0) ||
      a.display_name.localeCompare(b.display_name),
  );
}

export interface CategoryResults {
  categoryId: string;
  categoryName: string;
  sortOrder: number;
  rows: PublicResult[];
}

/** An event's published results, grouped by category in the usual category order. */
export async function getEventResults(eventId: string): Promise<CategoryResults[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("results", `event:${eventId}`);
  if (!isSupabaseConfigured() || !/^[0-9a-f-]{36}$/i.test(eventId)) return [];
  const [rows, { data: cats }] = await Promise.all([
    allPublicResults({ column: "event_id", value: eventId }),
    createPublicClient().from("categories").select("id, sort_order"),
  ]);
  const order = new Map(((cats ?? []) as { id: string; sort_order: number }[]).map((c) => [c.id, c.sort_order]));
  const groups = new Map<string, CategoryResults>();
  for (const r of rows) {
    let g = groups.get(r.category_id);
    if (!g) groups.set(r.category_id, (g = { categoryId: r.category_id, categoryName: r.category_name, sortOrder: order.get(r.category_id) ?? 0, rows: [] }));
    g.rows.push(r);
  }
  return [...groups.values()].sort((a, b) => a.sortOrder - b.sortOrder).map((g) => ({ ...g, rows: sortResults(g.rows) }));
}

export interface StandingsEvent {
  id: string;
  name: string;
  event_date: string;
}

export interface CategoryStandings {
  categoryId: string;
  categoryName: string;
  /** Events with published results in this category, oldest first. */
  events: StandingsEvent[];
  rows: (StandingRow & { displayName: string; team: string | null })[];
}

export interface SeasonStandings {
  season: { id: string; name: string; year: number };
  dropWorstN: number;
  categories: CategoryStandings[];
}

/**
 * Series standings for the active season (or the given one), per category.
 * Ranking happens in the points engine (src/lib/points.ts).
 */
export async function getStandings(seasonId?: string): Promise<SeasonStandings | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("results", "seasons");
  if (!isSupabaseConfigured()) return null;
  const supabase = createPublicClient();
  let q = supabase.from("seasons").select("id, name, year, points_rules(drop_worst_n)");
  q = seasonId ? q.eq("id", seasonId) : q.eq("is_active", true);
  const { data: seasonRow } = await q.maybeSingle();
  if (!seasonRow) return null;
  const season = seasonRow as unknown as { id: string; name: string; year: number; points_rules: { drop_worst_n: number } | null };

  const [results, { data: evs }, { data: cats }] = await Promise.all([
    allPublicResults({ column: "season_id", value: season.id }),
    supabase
      .from("events")
      .select("id, name, event_date, status")
      .eq("season_id", season.id)
      .neq("status", "draft")
      .is("deleted_at", null)
      .order("event_date"),
    supabase.from("categories").select("id, name, sort_order").order("sort_order"),
  ]);
  const events = new Map(((evs ?? []) as (StandingsEvent & { status: string })[]).filter((e) => e.status !== "canceled").map((e) => [e.id, e]));
  const dropWorstN = season.points_rules?.drop_worst_n ?? 0;

  const categories: CategoryStandings[] = [];
  for (const cat of (cats ?? []) as { id: string; name: string }[]) {
    const rows = results.filter((r) => r.category_id === cat.id && r.rider_id && events.has(r.event_id));
    if (!rows.length) continue;
    const names = new Map(rows.map((r) => [r.rider_id!, { displayName: r.display_name, team: r.team }]));
    const standings = computeStandings(
      rows.map((r) => ({
        riderId: r.rider_id!,
        eventId: r.event_id,
        eventDate: events.get(r.event_id)!.event_date,
        place: r.place,
        status: r.status,
        points: r.points_awarded,
      })),
      { dropWorstN },
    );
    const eventIds = new Set(rows.map((r) => r.event_id));
    categories.push({
      categoryId: cat.id,
      categoryName: cat.name,
      events: [...events.values()].filter((e) => eventIds.has(e.id)),
      rows: standings.map((s) => ({ ...s, ...names.get(s.riderId)! })),
    });
  }
  return { season: { id: season.id, name: season.name, year: season.year }, dropWorstN, categories };
}
