import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { staffOrResponse, NO_STORE } from "@/lib/staff/api";
import { ageOn } from "@/lib/time";
import type { RosterRow, RosterSnapshot } from "@/lib/offline/check-in-queue";

type DbRow = Omit<RosterRow, "is_minor"> & { birth_date: string | null };

/**
 * The roster for one event, for staff devices to cache. Birth dates are
 * reduced to an under-18 flag and emergency contacts are left out, because
 * this data stays on the device (D-074).
 */
export async function GET(request: NextRequest) {
  const auth = await staffOrResponse();
  if ("response" in auth) return auth.response;
  const eventId = request.nextUrl.searchParams.get("event") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return NextResponse.json({ error: "event required" }, { status: 400 });

  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("id, name, event_date, season_id").eq("id", eventId).maybeSingle();
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ev = event as { id: string; name: string; event_date: string; season_id: string };

  const [{ data, error }, { data: waiver }] = await Promise.all([
    supabase.rpc("staff_roster", { p_event_id: eventId }),
    supabase
      .from("waiver_versions")
      .select("id, title, version_number, body_markdown")
      .eq("season_id", ev.season_id)
      .eq("is_current", true)
      .maybeSingle(),
  ]);
  if (error) return NextResponse.json({ error: "roster_failed" }, { status: 500 });

  const rows: RosterRow[] = ((data ?? []) as DbRow[]).map(({ birth_date, ...r }) => ({
    ...r,
    is_minor: birth_date ? ageOn(birth_date, ev.event_date) < 18 : false,
  }));
  const snapshot: RosterSnapshot = {
    event: { id: ev.id, name: ev.name, event_date: ev.event_date },
    waiver: (waiver as RosterSnapshot["waiver"]) ?? null,
    rows,
    fetched_at: new Date().toISOString(),
  };
  return NextResponse.json(snapshot, { headers: NO_STORE });
}
