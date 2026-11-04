import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { csvResponseHeaders, toCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/time";

type Row = {
  id: string;
  typed_full_name: string;
  signed_at: string;
  ip_address: string | null;
  user_agent: string | null;
  guardian_name: string | null;
  guardian_relationship: string | null;
  guardian_typed_signature: string | null;
  pdf_path: string | null;
  waiver_versions: { version_number: number; title: string; season_id: string };
  rider: { first_name: string; last_name: string; email: string | null; birth_date: string | null } | null;
  collector: { first_name: string; last_name: string } | null;
};

/** All signatures for a season as CSV. Admins only (RLS enforces it too). */
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const season = request.nextUrl.searchParams.get("season") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(season)) return NextResponse.json({ error: "season required" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("waiver_signatures")
    .select(
      "id, typed_full_name, signed_at, ip_address, user_agent, guardian_name, guardian_relationship, guardian_typed_signature, pdf_path, waiver_versions!inner(version_number, title, season_id), rider:profiles!waiver_signatures_rider_id_fkey(first_name, last_name, email, birth_date), collector:profiles!waiver_signatures_collected_by_fkey(first_name, last_name)",
    )
    .eq("waiver_versions.season_id", season)
    .order("signed_at");
  if (error) return NextResponse.json({ error: "export failed" }, { status: 500 });

  const rows = ((data ?? []) as unknown as Row[]).map((s) => [
    s.id,
    s.waiver_versions.version_number,
    s.rider ? `${s.rider.first_name} ${s.rider.last_name}` : "",
    s.rider?.email ?? "",
    s.rider?.birth_date ?? "",
    s.typed_full_name,
    formatDateTime(s.signed_at),
    s.signed_at,
    s.ip_address ?? "",
    s.user_agent ?? "",
    s.guardian_name ?? "",
    s.guardian_relationship ?? "",
    s.guardian_typed_signature ?? "",
    s.collector ? `${s.collector.first_name} ${s.collector.last_name}` : "",
    s.pdf_path ? `${request.nextUrl.origin}/admin/waivers/signatures/${s.id}/pdf` : "",
  ]);
  const csv = toCsv(
    [
      "signature_id", "waiver_version", "rider_name", "rider_email", "rider_birth_date", "typed_signature",
      "signed_at_eastern", "signed_at_utc", "ip_address", "user_agent", "guardian_name", "guardian_relationship",
      "guardian_signature", "collected_by_staff", "pdf_link",
    ],
    rows,
  );
  return new NextResponse(csv, { headers: csvResponseHeaders(`waiver-signatures-${season.slice(0, 8)}.csv`) });
}
