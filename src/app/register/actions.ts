"use server";

import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getActiveSeason } from "@/lib/data";
import { getSettings } from "@/lib/settings";
import { stripeConfigured } from "@/lib/stripe";
import { rateLimit } from "@/lib/rate-limit";
import { describeError, describeWarning, errorCode } from "@/lib/messages";
import { isProfileComplete } from "@/lib/validation/profile";
import { registrationSelectionSchema } from "@/lib/validation/waiver";
import { releaseUnpaid, startRegistrationCheckout } from "@/lib/checkout";
import { sendRegistrationEmails } from "@/lib/registration-service";

export type RegisterState = {
  error?: string;
  selected?: string[];
  warnings?: { eventCategoryId: string; messages: string[] }[];
};

type RegisteredRow = { registration_id: string; event_category_id: string; status: string; price_cents: number };

export async function register(_prev: RegisterState, form: FormData): Promise<RegisterState> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/sign-in?next=/register");
  if (!isProfileComplete(profile)) redirect("/onboarding?next=/register");

  const parsed = registrationSelectionSchema.safeParse({
    event_category_ids: form.getAll("event_category_id").map(String),
    acknowledge: form.get("acknowledge") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const ids = parsed.data.event_category_ids;
  const selectedQuery = `/register?selected=${ids.join(",")}`;

  if (!rateLimit(`register:${profile.id}`, 15, 10 * 60 * 1000).ok) {
    return { error: "Too many registration attempts. Wait a few minutes and try again.", selected: ids };
  }

  const supabase = await createClient();
  const season = await getActiveSeason();
  if (!season) return { error: describeError("event_not_open"), selected: ids };

  const { data: waiver } = await supabase.rpc("my_waiver_status", { p_season_id: season.id }).single();
  const ws = waiver as { current_waiver_id: string | null; signed: boolean } | null;
  if (!ws?.current_waiver_id) return { error: describeError("no_current_waiver"), selected: ids };
  if (!ws.signed) redirect(`/waiver?next=${encodeURIComponent(selectedQuery)}`);

  // Warnings first, so the rider can read and acknowledge them.
  const { data: warningRows } = await supabase.rpc("my_eligibility_warnings", { p_event_category_ids: ids });
  const warnings = ((warningRows ?? []) as { event_category_id: string; warnings: string[] }[])
    .filter((w) => w.warnings.length > 0)
    .map((w) => ({ eventCategoryId: w.event_category_id, messages: w.warnings.map(describeWarning) }));
  if (warnings.length > 0 && !parsed.data.acknowledge) {
    return { selected: ids, warnings };
  }

  const settings = await getSettings();
  if (settings.paymentsEnabled && !stripeConfigured()) {
    const { data: prices } = await supabase.from("event_categories").select("price_cents").in("id", ids);
    if (((prices ?? []) as { price_cents: number }[]).some((p) => p.price_cents > 0)) {
      console.error("payments_enabled is on but STRIPE_SECRET_KEY is not set");
      return { error: "Online payment isn't set up yet. Register at the desk on race day.", selected: ids };
    }
  }

  const { data, error } = await supabase.rpc("register_for_event_categories", {
    p_event_category_ids: ids,
    p_acknowledged_warnings: warnings.length > 0,
  });
  if (error) {
    if (errorCode(error.message) === "waiver_required") redirect(`/waiver?next=${encodeURIComponent(selectedQuery)}`);
    if (errorCode(error.message) === "profile_incomplete") redirect(`/onboarding?next=${encodeURIComponent(selectedQuery)}`);
    if (errorCode(error.message) === "unknown") console.error("register failed", error.message);
    return { error: describeError(error.message), selected: ids };
  }
  const rows = (data ?? []) as RegisteredRow[];
  updateTag("registrations");

  const unpaid = rows.filter((r) => r.status === "pending_payment" && r.price_cents > 0).map((r) => r.registration_id);
  const done = rows.filter((r) => !unpaid.includes(r.registration_id)).map((r) => r.registration_id);
  if (done.length) {
    try {
      await sendRegistrationEmails(done);
    } catch (err) {
      console.error("registration email failed", err instanceof Error ? err.message : err);
    }
  }

  if (unpaid.length) {
    let url: string;
    try {
      url = await startRegistrationCheckout(profile, unpaid);
    } catch (err) {
      console.error("checkout failed", err instanceof Error ? err.message : err);
      await releaseUnpaid(unpaid);
      return { error: "We couldn't start the payment. Nothing was charged. Try again.", selected: ids };
    }
    redirect(url);
  }
  redirect(`/register/confirmation?ids=${rows.map((r) => r.registration_id).join(",")}`);
}
