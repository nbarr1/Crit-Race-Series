import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { staffOrResponse, NO_STORE } from "@/lib/staff/api";
import { describeError, errorCode } from "@/lib/messages";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  op_id: z.uuid(),
  device_id: z.string().max(100).optional(),
  existing_rider_id: z.uuid().nullable(),
  rider: z
    .object({
      first_name: z.string().trim().max(80).optional(),
      last_name: z.string().trim().max(80).optional(),
      email: z.union([z.literal(""), z.string().trim().toLowerCase().pipe(z.email())]).optional(),
      phone: z.string().trim().max(30).optional(),
      birth_date: z.union([z.literal(""), date]).optional(),
      gender: z.enum(["", "woman", "man", "non_binary", "prefer_not_to_say"]).optional(),
      team: z.string().trim().max(120).optional(),
      emergency_contact_name: z.string().trim().max(120).optional(),
      emergency_contact_relationship: z.string().trim().max(60).optional(),
      emergency_contact_phone: z.string().trim().max(30).optional(),
    })
    .default({}),
  event_category_id: z.uuid(),
  payment_method: z.enum(["cash", "card_at_desk", "stripe_link", "comp"]),
  amount_cents: z.number().int().min(0).max(100_000),
});

/** Walk-up registration at the desk. Needs a connection (D-073). */
export async function POST(request: NextRequest) {
  const auth = await staffOrResponse();
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid", message: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
  }
  const b = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_walk_up", {
    p_op_id: b.op_id,
    p_existing_rider_id: b.existing_rider_id,
    p_rider: b.rider,
    p_event_category_id: b.event_category_id,
    p_payment_method: b.payment_method,
    p_amount_cents: b.amount_cents,
    p_device_id: b.device_id ?? null,
  });
  if (error) {
    if (errorCode(error.message) === "unknown") console.error("walk-up failed", error.message);
    return NextResponse.json({ ok: false, error: errorCode(error.message), message: describeError(error.message) }, { status: 422, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, ...(data as object) }, { headers: NO_STORE });
}
