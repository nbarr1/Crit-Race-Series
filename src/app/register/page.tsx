import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireRider } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getActiveSeason, getOpenRaces } from "@/lib/data";
import { getSettings } from "@/lib/settings";
import { PageLoading } from "@/components/page-loading";
import { Alert } from "@/components/ui/card";
import { RegisterForm } from "@/components/register/register-form";

export const metadata: Metadata = { title: "Register" };

type Props = { searchParams: Promise<{ event?: string; selected?: string }> };

async function RegisterView({ searchParams }: Props) {
  const { event, selected } = await searchParams;
  const qs = new URLSearchParams();
  if (event) qs.set("event", event);
  if (selected) qs.set("selected", selected);
  const profile = await requireRider(`/register${qs.size ? `?${qs}` : ""}`);
  const [races, settings, season] = await Promise.all([getOpenRaces(), getSettings(), getActiveSeason()]);

  const supabase = await createClient();
  const { data: mine } = await supabase
    .from("registrations")
    .select("event_category_id")
    .eq("rider_id", profile.id)
    .not("status", "in", "(canceled,refunded)");
  const alreadyRegistered = ((mine ?? []) as { event_category_id: string }[]).map((r) => r.event_category_id);

  const waiverStatus = season
    ? ((await supabase.rpc("my_waiver_status", { p_season_id: season.id }).single()).data as { signed: boolean } | null)
    : null;

  const shown = event ? races.filter((r) => r.event.id === event) : races;
  const list = shown.length ? shown : races;
  const initial = selected ? selected.split(",") : [];

  if (races.length === 0) {
    return <p>No races are open for online registration right now. Check the <Link href="/schedule" className="font-semibold text-primary underline">schedule</Link>.</p>;
  }

  return (
    <div className="space-y-4">
      {waiverStatus && !waiverStatus.signed ? (
        <Alert tone="info">You&apos;ll sign this season&apos;s waiver before your registration is confirmed.</Alert>
      ) : null}
      {event && shown.length > 0 && races.length > 1 ? (
        <p>
          <Link href="/register" className="font-semibold text-primary underline">
            Register for several races at once
          </Link>
        </p>
      ) : null}
      <RegisterForm
        races={list}
        initialSelected={initial}
        alreadyRegistered={alreadyRegistered}
        paymentsEnabled={settings.paymentsEnabled}
      />
      {settings.paymentsEnabled && season?.season_pass_price_cents ? (
        <p>
          Racing all season?{" "}
          <Link href="/season-pass" className="font-semibold text-primary underline">
            Buy a season pass
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

export default function Page({ searchParams }: Props) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Register</h1>
      <Suspense fallback={<PageLoading label="Loading open races" />}>
        <RegisterView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
