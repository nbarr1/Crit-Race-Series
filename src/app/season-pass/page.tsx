import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireRider } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getActiveSeason } from "@/lib/data";
import { getSettings } from "@/lib/settings";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { applyPaidCheckout } from "@/lib/registration-service";
import { PageLoading } from "@/components/page-loading";
import { Alert } from "@/components/ui/card";
import { PassForm } from "@/components/season-pass/pass-form";

export const metadata: Metadata = { title: "Season pass" };

type Props = { searchParams: Promise<{ session_id?: string; checkout?: string }> };

async function SeasonPass({ searchParams }: Props) {
  const { session_id: sessionId, checkout } = await searchParams;
  const profile = await requireRider("/season-pass");
  const [season, settings] = await Promise.all([getActiveSeason(), getSettings()]);
  if (!season || !season.season_pass_price_cents || !settings.paymentsEnabled) {
    return <p>Season passes aren&apos;t on sale. Register race by race from the <Link className="font-semibold text-primary underline" href="/register">registration page</Link>.</p>;
  }

  if (sessionId && /^cs_[A-Za-z0-9_]+$/.test(sessionId) && stripeConfigured()) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId);
      if (session.metadata?.profile_id === profile.id && session.payment_status === "paid") await applyPaidCheckout(session);
    } catch (err) {
      console.error("season pass lookup failed", err instanceof Error ? err.message : err);
    }
  }

  const supabase = await createClient();
  const [{ data: pass }, { data: cats }] = await Promise.all([
    supabase
      .from("season_passes")
      .select("status, category_ids")
      .eq("rider_id", profile.id)
      .eq("season_id", season.id)
      .eq("status", "active")
      .maybeSingle(),
    supabase.from("categories").select("id, name, description").order("sort_order"),
  ]);
  const categories = (cats ?? []) as { id: string; name: string; description: string }[];
  const active = pass as { status: string; category_ids: string[] } | null;

  if (active) {
    const names = categories.filter((c) => active.category_ids.includes(c.id)).map((c) => c.name);
    return (
      <Alert tone="success">
        <p className="font-semibold">Your season pass is active for {names.join(", ")}.</p>
        <p>
          You&apos;re registered for every race in those categories. See{" "}
          <Link href="/my-races" className="font-semibold underline">
            My races
          </Link>
          .
        </p>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {checkout === "canceled" ? <Alert tone="info">Payment canceled. You weren&apos;t charged.</Alert> : null}
      {sessionId ? <Alert tone="info">We&apos;re confirming your payment. Refresh in a minute.</Alert> : null}
      <p>
        A season pass registers you for every {season.name} race in the categories you pick, including races added later.
        You&apos;re guaranteed a spot even when a race fills.
      </p>
      <PassForm categories={categories} priceCents={season.season_pass_price_cents} />
    </div>
  );
}

export default function Page({ searchParams }: Props) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Season pass</h1>
      <Suspense fallback={<PageLoading label="Loading" />}>
        <SeasonPass searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
