import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { createCheckoutSession, getStripe } from "@/lib/stripe";
import { formatEventDate, formatTime } from "@/lib/time";
import type { Profile } from "@/lib/types";

type PendingRow = {
  id: string;
  checkout_session_id: string | null;
  event_categories: { price_cents: number; start_at: string; categories: { name: string }; events: { name: string; event_date: string } };
};

/**
 * Starts Stripe Checkout for a rider's unpaid registrations and links the
 * session to them. Any older session for the same registrations is expired
 * first, so one registration can never be paid for twice.
 */
export async function startRegistrationCheckout(profile: Profile, registrationIds: string[]): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("registrations")
    .select("id, checkout_session_id, event_categories(price_cents, start_at, categories(name), events(name, event_date))")
    .in("id", registrationIds)
    .eq("rider_id", profile.id)
    .eq("status", "pending_payment");
  if (error) throw new Error(`load pending registrations: ${error.message}`);
  const rows = (data ?? []) as unknown as PendingRow[];
  if (rows.length === 0) throw new Error("nothing_to_pay");

  for (const old of new Set(rows.map((r) => r.checkout_session_id).filter((v): v is string => Boolean(v)))) {
    try {
      await getStripe().checkout.sessions.expire(old);
    } catch {
      // Already expired or completed. Completed sessions are confirmed by the webhook.
    }
  }

  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const session = await createCheckoutSession({
    kind: "registrations",
    profileId: profile.id,
    email: profile.email,
    items: rows.map((r) => ({
      name: `${r.event_categories.events.name}: ${r.event_categories.categories.name}`,
      description: `${formatEventDate(r.event_categories.events.event_date, "short")}, ${formatTime(r.event_categories.start_at)} ET`,
      amountCents: r.event_categories.price_cents,
    })),
    successUrl: `${site}/register/confirmation?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${site}/my-races?checkout=canceled`,
    idempotencyKey: `registration-checkout/${randomUUID()}`,
  });

  // Extend the hold so it outlasts the session, then link them.
  const holdUntil = new Date(((session.expires_at ?? 0) + 5 * 60) * 1000).toISOString();
  const { error: linkError } = await admin
    .from("registrations")
    .update({ checkout_session_id: session.id, pending_expires_at: holdUntil })
    .in(
      "id",
      rows.map((r) => r.id),
    );
  if (linkError) throw new Error(`link checkout: ${linkError.message}`);
  if (!session.url) throw new Error("checkout session has no URL");
  return session.url;
}

/** Undo holds when Checkout couldn't be started, so spots aren't stuck. */
export async function releaseUnpaid(registrationIds: string[]): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("registrations")
    .update({ status: "canceled", canceled_at: new Date().toISOString(), pending_expires_at: null })
    .in("id", registrationIds)
    .eq("status", "pending_payment")
    .select("event_category_id");
  for (const ec of new Set(((data ?? []) as { event_category_id: string }[]).map((r) => r.event_category_id))) {
    await admin.rpc("promote_waitlist", { p_event_category_id: ec });
  }
}
