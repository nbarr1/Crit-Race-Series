import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/env";
import type { Availability, EventCategory, RaceEvent, Venue } from "@/lib/types";

export type ScheduleEvent = RaceEvent & {
  venues: Pick<Venue, "name"> | null;
  event_categories: Pick<EventCategory, "start_at">[];
};

/**
 * Published, canceled, and completed events for the active season. Public
 * data, cached for a minute and tagged so staff edits can revalidate it.
 */
export async function getSchedule(): Promise<ScheduleEvent[] | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("events");
  if (!isSupabaseConfigured()) return null;
  const supabase = createPublicClient();
  const { data: season } = await supabase.from("seasons").select("id").eq("is_active", true).maybeSingle();
  if (!season) return [];
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, season_id, venue_id, name, event_date, registration_opens_at, registration_closes_at, status, notes, weather_override_text, venues(name), event_categories(start_at)",
    )
    .eq("season_id", season.id)
    .neq("status", "draft")
    .is("deleted_at", null)
    .order("event_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ScheduleEvent[];
}

export type EventDetail = RaceEvent & {
  venues: Venue | null;
  event_categories: EventCategory[];
  availability: Record<string, Availability>;
};

export async function getEvent(id: string): Promise<EventDetail | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("events", `event:${id}`);
  if (!isSupabaseConfigured()) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, season_id, venue_id, name, event_date, registration_opens_at, registration_closes_at, status, notes, weather_override_text, venues(*), event_categories(id, event_id, category_id, start_at, duration_minutes, laps, capacity, price_cents, walk_up_price_cents, categories(name, sort_order, description, eligibility_notes))",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const event = data as unknown as Omit<EventDetail, "availability">;
  event.event_categories.sort((a, b) => a.categories.sort_order - b.categories.sort_order);

  const { data: avail } = await supabase.from("event_category_availability").select("*").eq("event_id", id);
  const availability: Record<string, Availability> = {};
  for (const row of (avail ?? []) as Availability[]) availability[row.event_category_id] = row;
  return { ...event, availability };
}

export function eventPhase(e: Pick<RaceEvent, "status" | "event_date">, today: string): "upcoming" | "today" | "canceled" | "completed" {
  if (e.status === "canceled") return "canceled";
  if (e.status === "completed" || e.event_date < today) return "completed";
  if (e.event_date === today) return "today";
  return "upcoming";
}
