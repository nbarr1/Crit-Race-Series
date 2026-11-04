import { NextResponse, connection } from "next/server";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/env";
import { buildCalendar, ICS_HEADERS } from "@/lib/ics";
import { CALENDAR_SELECT, toCalendarEvent } from "@/lib/calendar";
import { SERIES_NAME } from "@/lib/site";

/** The whole active season as one calendar. Subscribing keeps it up to date. */
export async function GET() {
  await connection();
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const supabase = createPublicClient();
  const { data: season } = await supabase.from("seasons").select("id, name").eq("is_active", true).maybeSingle();
  if (!season) return NextResponse.json({ error: "no_active_season" }, { status: 404 });
  const { data } = await supabase
    .from("events")
    .select(CALENDAR_SELECT)
    .eq("season_id", (season as { id: string }).id)
    .neq("status", "draft")
    .is("deleted_at", null)
    .order("event_date");
  const entries = ((data ?? []) as never[]).map(toCalendarEvent).filter((e) => e !== null);
  return new NextResponse(buildCalendar((season as { name: string }).name || SERIES_NAME, entries), {
    headers: ICS_HEADERS("connestee-crit-series.ics"),
  });
}
