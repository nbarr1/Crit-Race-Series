import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { staffOrResponse, NO_STORE } from "@/lib/staff/api";
import { describeError } from "@/lib/messages";

/** Undoes a check-in. Online only, so it can't race with queued check-ins. */
export async function POST(request: NextRequest) {
  const auth = await staffOrResponse();
  if ("response" in auth) return auth.response;
  const parsed = z.object({ registration_id: z.uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.rpc("staff_undo_check_in", { p_registration_id: parsed.data.registration_id });
  if (error) return NextResponse.json({ ok: false, message: describeError(error.message) }, { status: 422, headers: NO_STORE });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
