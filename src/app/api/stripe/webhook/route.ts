import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { applyPaidCheckout, releaseCheckout } from "@/lib/registration-service";

/**
 * Stripe webhook. Configure the endpoint in the Stripe dashboard for:
 * checkout.session.completed, checkout.session.async_payment_succeeded,
 * checkout.session.expired, and checkout.session.async_payment_failed.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await applyPaidCheckout(event.data.object);
        break;
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
        await releaseCheckout(event.data.object.id);
        break;
      default:
        break;
    }
  } catch (err) {
    // A 500 makes Stripe retry. Every handler is idempotent.
    console.error("stripe webhook failed", event.type, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
