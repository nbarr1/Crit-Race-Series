import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;

/** Lazily created so builds and pages without Stripe keys still work. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(key, { appInfo: { name: "connestee-crit-series" } });
  return client;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export type CheckoutItem = { name: string; description?: string; amountCents: number };

/**
 * Creates a Checkout Session. Stripe's minimum session lifetime is 30
 * minutes; the database holds the spot a little longer (D-051) so a payment
 * finished at the last second still lands on a held spot.
 */
export async function createCheckoutSession(opts: {
  kind: "registrations" | "season_pass";
  profileId: string;
  email: string | null;
  items: CheckoutItem[];
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
  idempotencyKey: string;
}): Promise<Stripe.Checkout.Session> {
  const metadata = { kind: opts.kind, profile_id: opts.profileId, ...opts.metadata };
  return getStripe().checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: opts.profileId,
      customer_email: opts.email ?? undefined,
      line_items: opts.items.map((i) => ({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: i.amountCents,
          product_data: { name: i.name, description: i.description },
        },
      })),
      metadata,
      payment_intent_data: { metadata },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60 + 30,
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
    },
    { idempotencyKey: opts.idempotencyKey },
  );
}

/** The payment intent ID from a session, whether expanded or not. */
export function paymentIntentId(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  if (!pi) return null;
  return typeof pi === "string" ? pi : pi.id;
}
