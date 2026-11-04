import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireRider } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getActiveSeason } from "@/lib/data";
import { formatDateTime, formatEventDate, formatTime, nowMs, todayInDisplayTz } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { Alert, Badge, Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { RegistrationStatusBadge } from "@/components/registration-status";
import { RaceActions } from "@/components/my-races/race-actions";
import { CheckInCode } from "@/components/my-races/check-in-code";
import type { RegistrationStatus } from "@/lib/types";

export const metadata: Metadata = { title: "My races" };

type Row = {
  id: string;
  status: RegistrationStatus;
  bib_number: number | null;
  checked_in_at: string | null;
  pending_expires_at: string | null;
  waitlist_position: number | null;
  source: string;
  event_categories: {
    start_at: string;
    categories: { name: string };
    events: { id: string; name: string; event_date: string; registration_closes_at: string; status: string };
  };
};

type Props = { searchParams: Promise<{ signed?: string; checkout?: string }> };

async function MyRaces({ searchParams }: Props) {
  const { signed, checkout } = await searchParams;
  const profile = await requireRider("/my-races");
  const supabase = await createClient();
  const season = await getActiveSeason();

  const [{ data }, waiverRes] = await Promise.all([
    supabase
      .from("registrations")
      .select(
        "id, status, bib_number, checked_in_at, pending_expires_at, waitlist_position, source, event_categories(start_at, categories(name), events(id, name, event_date, registration_closes_at, status))",
      )
      .eq("rider_id", profile.id)
      .order("created_at", { ascending: false }),
    season ? supabase.rpc("my_waiver_status", { p_season_id: season.id }).single() : Promise.resolve({ data: null }),
  ]);
  const waiver = waiverRes.data as { current_waiver_id: string | null; signed: boolean } | null;

  const today = todayInDisplayTz();
  const now = nowMs();
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.event_categories?.events);
  const upcoming = rows
    .filter((r) => r.event_categories.events.event_date >= today && r.status !== "canceled" && r.status !== "refunded")
    .sort((a, b) => a.event_categories.start_at.localeCompare(b.event_categories.start_at));
  const past = rows.filter((r) => r.event_categories.events.event_date < today);

  return (
    <div className="space-y-6">
      <p>Hi, {profile.first_name}.</p>
      {signed ? <Alert tone="success">Thanks for signing. A PDF copy is on its way to your email.</Alert> : null}
      {checkout === "canceled" ? (
        <Alert tone="info">Payment canceled. Unpaid races hold your spot for a short time. Pay from the list to keep them.</Alert>
      ) : null}

      <section aria-labelledby="waiver-heading" className="space-y-2">
        <h2 id="waiver-heading" className="text-2xl font-bold">
          Waiver
        </h2>
        {waiver?.current_waiver_id ? (
          waiver.signed ? (
            <p>
              <Badge tone="success">Signed</Badge> You&apos;ve signed this season&apos;s waiver.{" "}
              <Link href="/waiver" className="font-semibold text-primary underline">
                View it or download your copy
              </Link>
              .
            </p>
          ) : (
            <div className="space-y-2">
              <p>
                <Badge tone="warning">Not signed</Badge> Sign this season&apos;s waiver before you race.
              </p>
              <Link href="/waiver" className={buttonVariants()}>
                Sign the waiver
              </Link>
            </div>
          )
        ) : (
          <p>The organizers haven&apos;t published this season&apos;s waiver yet.</p>
        )}
      </section>

      <section aria-labelledby="upcoming-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="upcoming-heading" className="text-2xl font-bold">
            Upcoming races
          </h2>
          <Link href="/register" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Register for a race
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p>
            You aren&apos;t registered for any upcoming races.{" "}
            <Link href="/schedule" className="font-semibold text-primary underline">
              See the schedule
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((r) => {
              const ev = r.event_categories.events;
              const open = now < new Date(ev.registration_closes_at).getTime();
              const holdActive = r.pending_expires_at ? new Date(r.pending_expires_at).getTime() > now : false;
              const label = `${ev.name}, ${r.event_categories.categories.name}`;
              return (
                <li key={r.id}>
                  <Card className="space-y-2">
                    <h3 className="text-xl font-bold">
                      <Link className="underline" href={`/events/${ev.id}`}>
                        {ev.name}
                      </Link>
                    </h3>
                    <p>
                      {r.event_categories.categories.name} · {formatEventDate(ev.event_date, "short")},{" "}
                      {formatTime(r.event_categories.start_at)}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <RegistrationStatusBadge status={r.status} waitlistPosition={r.waitlist_position} />
                      {r.source === "season_pass" ? <Badge>Season pass</Badge> : null}
                      {ev.status === "canceled" ? <Badge tone="danger">Event canceled</Badge> : null}
                      {r.bib_number ? <Badge>Bib {r.bib_number}</Badge> : null}
                      {r.checked_in_at ? <Badge tone="success">Checked in</Badge> : null}
                    </div>
                    {r.status === "pending_payment" && r.pending_expires_at ? (
                      <p className="text-sm">
                        {holdActive
                          ? `Your spot is held until ${formatDateTime(r.pending_expires_at)}. Pay before then to confirm it.`
                          : "Your hold has ended. The spot is released shortly."}
                      </p>
                    ) : null}
                    {r.status === "waitlisted" ? (
                      <p className="text-sm">We&apos;ll email you if a spot opens. You won&apos;t be charged unless it does.</p>
                    ) : null}
                    {r.status === "confirmed" && !r.checked_in_at && ev.status !== "canceled" ? (
                      <CheckInCode registrationId={r.id} label={label} />
                    ) : null}
                    <RaceActions
                      registrationId={r.id}
                      label={label}
                      canPay={r.status === "pending_payment" && holdActive}
                      canCancel={open && !r.checked_in_at && ["confirmed", "pending_payment", "waitlisted"].includes(r.status)}
                    />
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {past.length > 0 ? (
        <section aria-labelledby="past-heading" className="space-y-3">
          <h2 id="past-heading" className="text-2xl font-bold">
            Past races
          </h2>
          <ul className="space-y-2">
            {past.map((r) => (
              <li key={r.id}>
                {r.event_categories.events.name}, {r.event_categories.categories.name} ·{" "}
                {formatEventDate(r.event_categories.events.event_date, "short")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export default function Page({ searchParams }: Props) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">My races</h1>
      <Suspense fallback={<PageLoading label="Loading your races" />}>
        <MyRaces searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
