import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { sendEmail } from "@/lib/email/send";
import { promotedEmail, registrationEmail, seasonPassEmail, type RaceLine } from "@/lib/email/templates";
import { paymentIntentId } from "@/lib/stripe";
import { getSettings } from "@/lib/settings";

/**
 * Trusted server-side registration work: emails, payment confirmation, and
 * waitlist notices. Uses the service role, so every caller must already have
 * checked who is asking (or, for webhooks, verified Stripe's signature).
 */

type RegRow = {
  id: string;
  rider_id: string;
  status: RaceLine["status"];
  amount_paid_cents: number | null;
  waitlist_position: number | null;
  profiles: { email: string | null; first_name: string } | null;
  event_categories: {
    start_at: string;
    price_cents: number;
    categories: { name: string };
    events: { name: string; event_date: string };
  };
};

const REG_SELECT =
  "id, rider_id, status, amount_paid_cents, waitlist_position, profiles!registrations_rider_id_fkey(email, first_name), event_categories(start_at, price_cents, categories(name), events(name, event_date))";

async function loadRegistrations(ids: string[]): Promise<RegRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await createAdminClient().from("registrations").select(REG_SELECT).in("id", ids);
  if (error) throw new Error(`load registrations: ${error.message}`);
  return (data ?? []) as unknown as RegRow[];
}

function toRaceLine(r: RegRow): RaceLine {
  return {
    eventName: r.event_categories.events.name,
    eventDate: r.event_categories.events.event_date,
    categoryName: r.event_categories.categories.name,
    startAt: r.event_categories.start_at,
    status: r.status,
    amountPaidCents: r.amount_paid_cents,
    waitlistPosition: r.waitlist_position,
  };
}

function siteUrl(path: string): string {
  return `${publicEnv().NEXT_PUBLIC_SITE_URL}${path}`;
}

/** One email per rider listing their confirmed and waitlisted races. */
export async function sendRegistrationEmails(ids: string[]): Promise<void> {
  const rows = (await loadRegistrations(ids)).filter((r) => r.status === "confirmed" || r.status === "waitlisted");
  const byRider = new Map<string, RegRow[]>();
  for (const r of rows) byRider.set(r.rider_id, [...(byRider.get(r.rider_id) ?? []), r]);

  const admin = createAdminClient();
  for (const [, regs] of byRider) {
    const profile = regs[0].profiles;
    if (!profile?.email) continue;
    const msg = registrationEmail(profile.first_name || "rider", regs.map(toRaceLine), siteUrl("/my-races"));
    const sent = await sendEmail({
      to: profile.email,
      ...msg,
      idempotencyKey: `registration/${regs.map((r) => `${r.id}:${r.status}`).sort().join(",")}`.slice(0, 256),
    });
    if (sent) {
      await admin.from("registrations").update({ confirmation_sent_at: new Date().toISOString() }).in(
        "id",
        regs.map((r) => r.id),
      );
    }
  }
}

/** Emails every promoted rider who hasn't been told yet. */
export async function sendPromotionEmails(): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("registrations")
    .select("id")
    .not("promoted_at", "is", null)
    .is("promotion_notified_at", null)
    .in("status", ["confirmed", "pending_payment"])
    .limit(100);
  const rows = await loadRegistrations(((data ?? []) as { id: string }[]).map((r) => r.id));
  const { waitlistOfferHours } = await getSettings();
  let count = 0;
  for (const r of rows) {
    if (r.profiles?.email) {
      const msg = promotedEmail(r.profiles.first_name || "rider", toRaceLine(r), siteUrl("/my-races"), waitlistOfferHours);
      const sent = await sendEmail({ to: r.profiles.email, ...msg, idempotencyKey: `promoted/${r.id}` });
      if (!sent) continue;
    }
    await admin.from("registrations").update({ promotion_notified_at: new Date().toISOString() }).eq("id", r.id);
    count++;
  }
  return count;
}

export type CheckoutOutcome = { kind: "registrations" | "season_pass" | "unknown"; confirmedIds: string[]; needsRefund: string[] };

/**
 * Applies a paid Checkout Session. Safe to call more than once for the same
 * session (from the webhook and from the confirmation page).
 */
export async function applyPaidCheckout(session: Stripe.Checkout.Session): Promise<CheckoutOutcome> {
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    return { kind: "unknown", confirmedIds: [], needsRefund: [] };
  }
  const admin = createAdminClient();
  const kind = session.metadata?.kind;
  const reference = paymentIntentId(session) ?? session.id;

  if (kind === "registrations") {
    const { data: regs } = await admin
      .from("registrations")
      .select("id, event_categories(price_cents)")
      .eq("checkout_session_id", session.id);
    const amounts: Record<string, number> = {};
    for (const r of (regs ?? []) as unknown as { id: string; event_categories: { price_cents: number } }[]) {
      amounts[r.id] = r.event_categories.price_cents;
    }
    const { data, error } = await admin.rpc("confirm_paid_registrations", {
      p_checkout_session_id: session.id,
      p_payment_reference: reference,
      p_amounts: amounts,
    });
    if (error) throw new Error(`confirm_paid_registrations: ${error.message}`);
    const outcomes = (data ?? []) as { registration_id: string; outcome: string }[];
    const confirmedIds = outcomes.filter((o) => o.outcome.startsWith("confirmed")).map((o) => o.registration_id);
    const needsRefund = outcomes.filter((o) => o.outcome === "needs_refund").map((o) => o.registration_id);
    if (needsRefund.length) console.warn("paid after hold expired; staff must refund", session.id, needsRefund);
    await sendRegistrationEmails(confirmedIds);
    return { kind: "registrations", confirmedIds, needsRefund };
  }

  if (kind === "season_pass") {
    const passId = session.metadata?.season_pass_id;
    if (!passId) return { kind: "unknown", confirmedIds: [], needsRefund: [] };
    const { data: before } = await admin.from("season_passes").select("status").eq("id", passId).single();
    const { data: added, error } = await admin.rpc("activate_season_pass", {
      p_season_pass_id: passId,
      p_payment_reference: reference,
      p_amount_cents: session.amount_total ?? 0,
    });
    if (error) throw new Error(`activate_season_pass: ${error.message}`);
    if ((before as { status: string } | null)?.status !== "active") {
      await sendSeasonPassEmail(passId, Number(added ?? 0));
    }
    return { kind: "season_pass", confirmedIds: [], needsRefund: [] };
  }

  return { kind: "unknown", confirmedIds: [], needsRefund: [] };
}

async function sendSeasonPassEmail(passId: string, added: number) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("season_passes")
    .select("category_ids, profiles!season_passes_rider_id_fkey(email, first_name)")
    .eq("id", passId)
    .single();
  const pass = data as unknown as { category_ids: string[]; profiles: { email: string | null; first_name: string } | null } | null;
  if (!pass?.profiles?.email) return;
  const { data: cats } = await admin.from("categories").select("name").in("id", pass.category_ids);
  const names = ((cats ?? []) as { name: string }[]).map((c) => c.name);
  await sendEmail({
    to: pass.profiles.email,
    ...seasonPassEmail(pass.profiles.first_name || "rider", names, added, siteUrl("/my-races")),
    idempotencyKey: `season-pass/${passId}`,
  });
}

/** Releases the holds for an expired or abandoned Checkout Session. */
export async function releaseCheckout(sessionId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("release_checkout", { p_checkout_session_id: sessionId });
  if (error) throw new Error(`release_checkout: ${error.message}`);
  await admin
    .from("season_passes")
    .update({ status: "canceled" })
    .eq("checkout_session_id", sessionId)
    .eq("status", "pending_payment");
  await sendPromotionEmails();
}
