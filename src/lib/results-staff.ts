import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { EventEntrant } from "@/lib/results-match";
import type { ResultStatus } from "@/lib/points";

type Client = Awaited<ReturnType<typeof createClient>>;

export interface StaffEventCategory {
  id: string;
  event_id: string;
  start_at: string;
  event: { id: string; name: string; event_date: string; season_id: string };
  category: { name: string };
}

export async function loadEventCategory(supabase: Client, ecId: string): Promise<StaffEventCategory | null> {
  const { data } = await supabase
    .from("event_categories")
    .select("id, event_id, start_at, event:events(id, name, event_date, season_id), category:categories(name)")
    .eq("id", ecId)
    .maybeSingle();
  return (data as unknown as StaffEventCategory | null) ?? null;
}

/** Confirmed riders at an event, across all its categories, from the check-in roster. */
export async function loadEntrants(supabase: Client, eventId: string): Promise<EventEntrant[]> {
  const { data, error } = await supabase.rpc("staff_roster", { p_event_id: eventId });
  if (error) throw new Error(`staff_roster failed: ${error.message}`);
  type Row = {
    rider_id: string; event_category_id: string; category_name: string; bib_number: number | null;
    first_name: string; last_name: string; display_name: string; team: string | null; status: string;
  };
  return ((data ?? []) as Row[])
    .filter((r) => r.status === "confirmed")
    .map((r) => ({
      riderId: r.rider_id,
      eventCategoryId: r.event_category_id,
      categoryName: r.category_name,
      bib: r.bib_number,
      firstName: r.first_name,
      lastName: r.last_name,
      displayName: r.display_name,
      team: r.team,
    }));
}

export interface SavedResult {
  id: string;
  rider_id: string | null;
  raw_name: string;
  bib: number | null;
  place: number | null;
  status: ResultStatus;
  laps: number | null;
  points_awarded: number;
  is_published: boolean;
  published_at: string | null;
  rider: { first_name: string; last_name: string } | null;
}

export async function loadSavedResults(supabase: Client, ecId: string): Promise<SavedResult[]> {
  const { data, error } = await supabase
    .from("results")
    .select("id, rider_id, raw_name, bib, place, status, laps, points_awarded, is_published, published_at, rider:profiles(first_name, last_name)")
    .eq("event_category_id", ecId)
    .order("place");
  if (error) throw new Error(`results read failed: ${error.message}`);
  const order: Record<ResultStatus, number> = { finished: 0, DNF: 1, DNS: 2, DQ: 3 };
  return ((data ?? []) as unknown as SavedResult[]).sort(
    (a, b) => order[a.status] - order[b.status] || (a.place ?? 0) - (b.place ?? 0) || a.raw_name.localeCompare(b.raw_name),
  );
}
