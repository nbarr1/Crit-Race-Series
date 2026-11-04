import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/admin/server";
import { csvResponseHeaders, toCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/time";

type Row = {
  id: string;
  status: string;
  source: string;
  payment_method: string;
  amount_paid_cents: number | null;
  bib_number: number | null;
  checked_in_at: string | null;
  created_at: string;
  eligibility_override_reason: string | null;
  events: { name: string; event_date: string; season_id: string };
  event_categories: { categories: { name: string } };
  profiles: {
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    birth_date: string | null;
    team: string | null;
    usac_license_number: string | null;
  };
};

const PAGE = 1000;

/**
 * Registrations as CSV, for one event (?event=) or a whole season (?season=).
 * Admins only. Rows are read a page at a time, since responses cap at 1,000.
 */
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const eventId = request.nextUrl.searchParams.get("event") ?? "";
  const seasonId = request.nextUrl.searchParams.get("season") ?? "";
  if (!UUID_RE.test(eventId) && !UUID_RE.test(seasonId)) return NextResponse.json({ error: "event or season required" }, { status: 400 });

  const supabase = await createClient();
  let eventIds = [eventId];
  if (!UUID_RE.test(eventId)) {
    const { data: evs } = await supabase.from("events").select("id").eq("season_id", seasonId).is("deleted_at", null);
    eventIds = ((evs ?? []) as { id: string }[]).map((e) => e.id);
  }
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    if (eventIds.length === 0) break;
    const { data, error } = await supabase
      .from("registrations")
      .select(
        "id, status, source, payment_method, amount_paid_cents, bib_number, checked_in_at, created_at, eligibility_override_reason, events(name, event_date, season_id), event_categories(categories(name)), profiles!registrations_rider_id_fkey(first_name, last_name, email, phone, birth_date, team, usac_license_number)",
      )
      .order("created_at")
      .order("id")
      .in("event_id", eventIds)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("registrations export failed", error.message);
      return NextResponse.json({ error: "export failed" }, { status: 500 });
    }
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  rows.sort(
    (a, b) =>
      a.events.event_date.localeCompare(b.events.event_date) ||
      a.event_categories.categories.name.localeCompare(b.event_categories.categories.name) ||
      a.profiles.last_name.localeCompare(b.profiles.last_name) ||
      a.profiles.first_name.localeCompare(b.profiles.first_name),
  );

  const csv = toCsv(
    [
      "event", "event_date", "category", "last_name", "first_name", "email", "phone", "birth_date", "team",
      "usac_license", "status", "source", "payment_method", "amount_paid", "bib", "checked_in_at_eastern",
      "registered_at_eastern", "eligibility_override", "registration_id",
    ],
    rows.map((r) => [
      r.events.name,
      r.events.event_date,
      r.event_categories.categories.name,
      r.profiles.last_name,
      r.profiles.first_name,
      r.profiles.email ?? "",
      r.profiles.phone ?? "",
      r.profiles.birth_date ?? "",
      r.profiles.team ?? "",
      r.profiles.usac_license_number ?? "",
      r.status,
      r.source,
      r.payment_method,
      r.amount_paid_cents === null ? "" : (r.amount_paid_cents / 100).toFixed(2),
      r.bib_number ?? "",
      r.checked_in_at ? formatDateTime(r.checked_in_at) : "",
      formatDateTime(r.created_at),
      r.eligibility_override_reason ?? "",
      r.id,
    ]),
  );
  const name = UUID_RE.test(eventId) ? `registrations-${eventId.slice(0, 8)}.csv` : `registrations-season-${seasonId.slice(0, 8)}.csv`;
  return new NextResponse(csv, { headers: csvResponseHeaders(name) });
}
