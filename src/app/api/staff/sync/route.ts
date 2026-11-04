import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { staffOrResponse, NO_STORE } from "@/lib/staff/api";
import { describeError, errorCode } from "@/lib/messages";
import { userAgent } from "@/lib/request";
import { finalizeSignature } from "@/lib/waiver-service";
import type { OpResult } from "@/lib/offline/check-in-queue";

const iso = z.iso.datetime({ offset: true });
const base = { op_id: z.uuid(), queued_at: iso };
const opSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("check_in"), registration_id: z.uuid(), bib: z.number().int().nullable(), checked_in_at: iso }),
  z.object({
    ...base,
    type: z.literal("record_payment"),
    registration_id: z.uuid(),
    payment_method: z.enum(["cash", "card_at_desk", "stripe_link", "comp"]),
    amount_cents: z.number().int().min(0).max(100_000),
  }),
  z.object({ ...base, type: z.literal("override_eligibility"), registration_id: z.uuid(), reason: z.string().trim().min(1).max(500) }),
  z.object({
    ...base,
    type: z.literal("collect_waiver"),
    rider_id: z.uuid(),
    waiver_version_id: z.uuid(),
    typed_full_name: z.string().trim().min(2).max(160),
    signed_at: iso,
    guardian_name: z.string().trim().max(160).optional(),
    guardian_relationship: z.string().trim().max(60).optional(),
    guardian_typed_signature: z.string().trim().max(160).optional(),
  }),
]);
const bodySchema = z.object({ device_id: z.string().min(1).max(100), ops: z.array(opSchema).max(200) });

/**
 * Replays a staff device's queued operations in order. Each operation is
 * idempotent by op_id, so a device can resend after a dropped connection.
 * Runs as the signed-in staff member, so row-level security, staff checks,
 * and the audit log all see the real actor.
 */
export async function POST(request: NextRequest) {
  const auth = await staffOrResponse();
  if ("response" in auth) return auth.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const supabase = await createClient();
  const ua = await userAgent();
  const results: OpResult[] = [];
  const newSignatures: string[] = [];

  for (const op of body.ops) {
    let res: { data: unknown; error: { message: string } | null };
    switch (op.type) {
      case "check_in":
        res = await supabase
          .rpc("staff_check_in", {
            p_op_id: op.op_id,
            p_registration_id: op.registration_id,
            p_bib: op.bib,
            p_checked_in_at: op.checked_in_at,
            p_device_id: body.device_id,
          })
          .single();
        break;
      case "record_payment":
        res = await supabase.rpc("staff_record_payment", {
          p_op_id: op.op_id,
          p_registration_id: op.registration_id,
          p_payment_method: op.payment_method,
          p_amount_cents: op.amount_cents,
          p_device_id: body.device_id,
        });
        break;
      case "override_eligibility":
        res = await supabase.rpc("staff_override_eligibility", {
          p_op_id: op.op_id,
          p_registration_id: op.registration_id,
          p_reason: op.reason,
          p_device_id: body.device_id,
        });
        break;
      case "collect_waiver":
        res = await supabase.rpc("staff_collect_waiver", {
          p_op_id: op.op_id,
          p_rider_id: op.rider_id,
          p_waiver_version_id: op.waiver_version_id,
          p_typed_full_name: op.typed_full_name,
          p_signed_at: op.signed_at,
          p_user_agent: ua,
          p_guardian_name: op.guardian_name ?? null,
          p_guardian_relationship: op.guardian_relationship ?? null,
          p_guardian_typed_signature: op.guardian_typed_signature ?? null,
          p_device_id: body.device_id,
        });
        break;
    }
    if (res.error) {
      const code = errorCode(res.error.message);
      if (code === "unknown") console.error("staff op failed", op.type, res.error.message);
      // A signed-out session stops the batch: later ops stay queued.
      if (code === "staff_only") return NextResponse.json({ error: "staff_only", results }, { status: 403, headers: NO_STORE });
      results.push({ op_id: op.op_id, ok: false, error: code, message: describeError(res.error.message) });
    } else {
      const data = res.data as { outcome?: string; signature_id?: string } | null;
      results.push({ op_id: op.op_id, ok: true, outcome: data?.outcome });
      if (op.type === "collect_waiver" && data?.outcome === "signed" && data.signature_id) newSignatures.push(data.signature_id);
    }
  }

  if (newSignatures.length) {
    // PDFs and email copies after responding; the scheduled job retries failures.
    after(async () => {
      for (const id of newSignatures) {
        try {
          await finalizeSignature(id);
        } catch (err) {
          console.error("finalize staff-collected signature failed", id, err instanceof Error ? err.message : err);
        }
      }
    });
  }
  return NextResponse.json({ results }, { headers: NO_STORE });
}
