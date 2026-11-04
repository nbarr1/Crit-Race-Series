"use server";

import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeError } from "@/lib/messages";
import { rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { startRegistrationCheckout } from "@/lib/checkout";
import { sendPromotionEmails } from "@/lib/registration-service";
import { sendEmail } from "@/lib/email/send";
import { cancellationEmail } from "@/lib/email/templates";

const idSchema = z.object({ registration_id: z.uuid() });

export type RaceActionState = { error?: string; message?: string };

type CancelRow = {
  registration_id: string;
  previous_status: string;
  payment_method: string;
  payment_reference: string | null;
  amount_paid_cents: number | null;
};

export async function cancelRegistration(_prev: RaceActionState, form: FormData): Promise<RaceActionState> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/sign-in?next=/my-races");
  const parsed = idSchema.safeParse({ registration_id: form.get("registration_id") });
  if (!parsed.success) return { error: describeError("not_found") };
  if (!rateLimit(`cancel:${profile.id}`, 10, 10 * 60 * 1000).ok) return { error: "Too many attempts. Try again later." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_my_registration", { p_registration_id: parsed.data.registration_id }).single();
  if (error) return { error: describeError(error.message) };
  const row = data as CancelRow;
  updateTag("registrations");

  // Refunds follow the admin's policy. Default: staff decide by hand (D-055).
  const { refundPolicy } = await getSettings();
  let refundNote = "If you paid online, the organizers will contact you about a refund.";
  if (row.previous_status === "waitlisted" || row.previous_status === "pending_payment" || !row.amount_paid_cents) {
    refundNote = "You weren't charged for this race.";
  } else if (
    refundPolicy === "full_refund_before_close" &&
    row.payment_method === "stripe" &&
    row.payment_reference?.startsWith("pi_") &&
    stripeConfigured()
  ) {
    try {
      await getStripe().refunds.create(
        { payment_intent: row.payment_reference, amount: row.amount_paid_cents, metadata: { registration_id: row.registration_id } },
        { idempotencyKey: `refund/${row.registration_id}` },
      );
      await createAdminClient().from("registrations").update({ status: "refunded" }).eq("id", row.registration_id);
      refundNote = "A full refund is on its way to your card. It can take 5-10 business days to appear.";
    } catch (err) {
      console.error("refund failed", row.registration_id, err instanceof Error ? err.message : err);
      refundNote = "We couldn't issue the refund automatically. The organizers will follow up.";
    }
  }

  try {
    await sendPromotionEmails();
    const { data: reg } = await supabase
      .from("registrations")
      .select("status, event_categories(start_at, categories(name), events(name, event_date))")
      .eq("id", row.registration_id)
      .single();
    const r = reg as unknown as {
      status: "canceled" | "refunded";
      event_categories: { start_at: string; categories: { name: string }; events: { name: string; event_date: string } };
    } | null;
    if (r && profile.email) {
      await sendEmail({
        to: profile.email,
        ...cancellationEmail(
          profile.first_name,
          {
            eventName: r.event_categories.events.name,
            eventDate: r.event_categories.events.event_date,
            categoryName: r.event_categories.categories.name,
            startAt: r.event_categories.start_at,
            status: r.status,
          },
          refundNote,
        ),
        idempotencyKey: `cancel/${row.registration_id}`,
      });
    }
  } catch (err) {
    console.error("cancel follow-up failed", err instanceof Error ? err.message : err);
  }
  return { message: `Registration canceled. ${refundNote}` };
}

export async function payRegistration(_prev: RaceActionState, form: FormData): Promise<RaceActionState> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/sign-in?next=/my-races");
  const parsed = idSchema.safeParse({ registration_id: form.get("registration_id") });
  if (!parsed.success) return { error: describeError("not_found") };
  if (!stripeConfigured()) return { error: "Online payment isn't set up yet. Pay at the desk on race day." };

  let url: string;
  try {
    url = await startRegistrationCheckout(profile, [parsed.data.registration_id]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "nothing_to_pay") return { error: "That registration doesn't need payment, or its hold has ended." };
    console.error("pay checkout failed", message);
    return { error: "We couldn't start the payment. Try again." };
  }
  redirect(url);
}
