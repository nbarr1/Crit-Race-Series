import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { staffOrResponse, NO_STORE } from "@/lib/staff/api";

/** Finds existing riders for the walk-up form. Staff only. */
export async function GET(request: NextRequest) {
  const auth = await staffOrResponse();
  if ("response" in auth) return auth.response;
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_find_riders", { p_query: q });
  if (error) return NextResponse.json({ error: "search_failed" }, { status: 500 });
  return NextResponse.json({ riders: data ?? [] }, { headers: NO_STORE });
}
