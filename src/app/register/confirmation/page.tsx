import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireRider } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { applyPaidCheckout } from "@/lib/registration-service";
import { formatEventDate, formatTime } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { Alert, Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { RegistrationStatusBadge } from "@/components/registration-status";
import type { RegistrationStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Registration confirmation" };

type Props = { searchParams: Promise<{ ids?: string; session_id?: string }> };

type Row = {
  id: string;
  status: RegistrationStatus;
  waitlist_position: number | null;
  event_categories: { start_at: string; categories: { name: string }; events: { name: string; event_date: string } };
};

const UUID = /^[0-9a-f-]{36}$/i;

async function Confirmation({ searchParams }: Props) {
  const { ids, session_id: sessionId } = await searchParams;
  const profile = await requireRider("/my-races");
  let paymentNote: string | null = null;

  // Don't wait for the webhook: check the session with Stripe directly. Both
  // paths are idempotent.
  if (sessionId && /^cs_[A-Za-z0-9_]+$/.test(sessionId) && stripeConfigured()) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId);
      if (session.metadata?.profile_id !== profile.id) {
        paymentNote = "We couldn't match this payment to your account.";
      } else if (session.payment_status === "paid") {
        await applyPaidCheckout(session);
      } else {
        paymentNote = "Your payment is still processing. We'll email you when it's confirmed.";
      }
    } catch (err) {
      console.error("checkout lookup failed", err instanceof Error ? err.message : err);
      paymentNote = "We're confirming your payment. Check My races in a minute.";
    }
  }

  const supabase = await createClient();
  let query = supabase
    .from("registrations")
    .select("id, status, waitlist_position, event_categories(start_at, categories(name), events(name, event_date))")
    .eq("rider_id", profile.id);
  if (sessionId) query = query.eq("checkout_session_id", sessionId);
  else query = query.in("id", (ids ?? "").split(",").filter((id) => UUID.test(id)));
  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="space-y-4">
      {paymentNote ? <Alert tone="info">{paymentNote}</Alert> : null}
      {rows.length === 0 ? (
        <p>We couldn&apos;t find those registrations. Check My races.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="space-y-1">
                <p className="text-lg font-bold">
                  {r.event_categories.events.name}: {r.event_categories.categories.name}
                </p>
                <p>
                  {formatEventDate(r.event_categories.events.event_date, "short")}, {formatTime(r.event_categories.start_at)}
                </p>
                <RegistrationStatusBadge status={r.status} waitlistPosition={r.waitlist_position} />
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p>We emailed you a copy. On race day, check in at the registration desk with the code on My races.</p>
      <Link href="/my-races" className={buttonVariants({ size: "lg" })}>
        Go to My races
      </Link>
    </div>
  );
}

export default function Page({ searchParams }: Props) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Registration</h1>
      <Suspense fallback={<PageLoading label="Confirming your registration" />}>
        <Confirmation searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
