import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signedPdfUrl } from "@/lib/waiver-service";

/** Redirects an admin to a short-lived link for one signed waiver PDF. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Read through RLS so only rows the admin may see are found.
  const supabase = await createClient();
  const { data } = await supabase.from("waiver_signatures").select("pdf_path").eq("id", id).maybeSingle();
  const path = (data as { pdf_path: string | null } | null)?.pdf_path;
  if (!path) return NextResponse.json({ error: "PDF not ready" }, { status: 404 });
  const url = await signedPdfUrl(path, 120);
  if (!url) return NextResponse.json({ error: "PDF not available" }, { status: 404 });
  return NextResponse.redirect(url, { headers: { "cache-control": "no-store" } });
}
