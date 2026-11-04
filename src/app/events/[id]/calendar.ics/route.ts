import { NextResponse, connection, type NextRequest } from "next/server";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/env";
import { buildCalendar, ICS_HEADERS } from "@/lib/ics";
import { CALENDAR_SELECT, toCalendarEvent } from "@/lib/calendar";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;
  if (!isSupabaseConfigured() || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data } = await createPublicClient().from("events").select(CALENDAR_SELECT).eq("id", id).neq("status", "draft").is("deleted_at", null).maybeSingle();
  const entry = data ? toCalendarEvent(data as never) : null;
  if (!entry) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const name = (data as { name: string }).name;
  return new NextResponse(buildCalendar(name, [entry]), { headers: ICS_HEADERS(`${name}.ics`) });
}
