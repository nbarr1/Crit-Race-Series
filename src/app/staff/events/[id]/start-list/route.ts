import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { staffOrResponse } from "@/lib/staff/api";
import { csvResponseHeaders, toCsv } from "@/lib/csv";
import { buildStartListPdf, type StartListSection } from "@/lib/start-list-pdf";
import { formatEventDate, formatTime } from "@/lib/time";

type Row = {
  bib_number: number | null;
  checked_in_at: string | null;
  event_category_id: string;
  rider: { first_name: string; last_name: string; team: string | null; usac_license_number: string | null };
  event_categories: { start_at: string; categories: { name: string; sort_order: number } };
};

/**
 * Start list for officials: confirmed riders by category, sorted by bib.
 *   ?format=csv|pdf   &category=<event category id> (optional, default all)
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await staffOrResponse();
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const format = request.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "csv";
  const category = request.nextUrl.searchParams.get("category");
  if (!/^[0-9a-f-]{36}$/i.test(id) || (category && !/^[0-9a-f-]{36}$/i.test(category))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("name, event_date").eq("id", id).maybeSingle();
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
  let query = supabase
    .from("registrations")
    .select(
      "bib_number, checked_in_at, event_category_id, rider:profiles!registrations_rider_id_fkey(first_name, last_name, team, usac_license_number), event_categories(start_at, categories(name, sort_order))",
    )
    .eq("event_id", id)
    .eq("status", "confirmed");
  if (category) query = query.eq("event_category_id", category);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "export_failed" }, { status: 500 });

  const rows = ((data ?? []) as unknown as Row[]).sort(
    (a, b) =>
      a.event_categories.categories.sort_order - b.event_categories.categories.sort_order ||
      (a.bib_number ?? Number.MAX_SAFE_INTEGER) - (b.bib_number ?? Number.MAX_SAFE_INTEGER) ||
      a.rider.last_name.localeCompare(b.rider.last_name),
  );
  const ev = event as { name: string; event_date: string };
  const slug = `${ev.event_date}-${ev.name}`.replace(/[^A-Za-z0-9-]+/g, "-").toLowerCase();

  if (format === "csv") {
    const csv = toCsv(
      ["category", "start_time", "bib", "first_name", "last_name", "team", "usac_license", "checked_in"],
      rows.map((r) => [
        r.event_categories.categories.name,
        formatTime(r.event_categories.start_at),
        r.bib_number,
        r.rider.first_name,
        r.rider.last_name,
        r.rider.team,
        r.rider.usac_license_number,
        r.checked_in_at ? "yes" : "no",
      ]),
    );
    return new NextResponse(csv, { headers: csvResponseHeaders(`start-list-${slug}.csv`) });
  }

  const sections = new Map<string, StartListSection>();
  for (const r of rows) {
    const s = sections.get(r.event_category_id) ?? {
      category: r.event_categories.categories.name,
      startTime: formatTime(r.event_categories.start_at),
      entries: [],
    };
    s.entries.push({
      bib: r.bib_number,
      name: `${r.rider.first_name} ${r.rider.last_name}`,
      team: r.rider.team ?? "",
      license: r.rider.usac_license_number ?? "",
      checkedIn: Boolean(r.checked_in_at),
    });
    sections.set(r.event_category_id, s);
  }
  const pdf = await buildStartListPdf(ev.name, formatEventDate(ev.event_date), [...sections.values()]);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="start-list-${slug}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
