import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDashboard, getSettingsAdmin, pickSeason } from "@/lib/admin/data";
import { formatCents, formatEventDate, todayInDisplayTz } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { Card } from "@/components/ui/card";
import { EventStatusBadge } from "@/components/admin/status";

export const metadata: Metadata = { title: "Admin" };

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border-2 border-border p-3">
      <dt className="text-sm font-semibold text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-bold">{value}</dd>
    </div>
  );
}

type Todo = { done: boolean; text: string; href: string; link: string };

async function Dashboard() {
  await requireAdmin("/admin");
  const supabase = await createClient();
  const { season } = await pickSeason(supabase, undefined);
  if (!season) {
    return (
      <Card className="space-y-2">
        <h2 className="text-2xl font-bold">Start here</h2>
        <p>
          <Link href="/admin/seasons" className="font-semibold text-primary underline">Create a season</Link>, add its events, then publish a waiver.
        </p>
      </Card>
    );
  }
  const [dash, settings] = await Promise.all([getDashboard(supabase, season.id), getSettingsAdmin(supabase)]);
  if (!dash) return <p role="alert">The dashboard couldn&apos;t load. Reload the page.</p>;

  const today = todayInDisplayTz();
  const live = dash.events.filter((e) => e.status !== "canceled");
  const upcoming = live.filter((e) => e.event_date >= today).slice(0, 5);
  const raceRevenue = dash.events.reduce((n, e) => n + e.revenue_cents, 0);
  const drafts = dash.events.filter((e) => e.status === "draft").length;

  const todos: Todo[] = [
    { done: season.is_active, text: `${season.name} is the active season.`, href: "/admin/seasons", link: "Seasons" },
    { done: dash.events.length > 0, text: "The season has events.", href: `/admin/events?season=${season.id}`, link: "Events" },
    { done: drafts === 0, text: drafts ? `${drafts} ${drafts === 1 ? "event is a draft" : "events are drafts"}, hidden from riders.` : "Every event is published.", href: `/admin/events?season=${season.id}`, link: "Events" },
    { done: dash.waiver_version !== null, text: dash.waiver_version !== null ? `Waiver version ${dash.waiver_version} is published.` : "No waiver yet. Riders can't register until one is published.", href: "/admin/waivers", link: "Waivers" },
    { done: dash.placeholder_prices === 0, text: dash.placeholder_prices ? `${dash.placeholder_prices} race categories still have the placeholder prices.` : "Race prices are set.", href: `/admin/events?season=${season.id}`, link: "Events" },
    { done: dash.unconfirmed_venues === 0, text: dash.unconfirmed_venues ? "The venue address and coordinates aren't confirmed." : "The venue is confirmed.", href: "/admin/venues", link: "Venue" },
    { done: dash.staff > 1, text: `${dash.staff} staff and admins.`, href: "/admin/people", link: "Staff" },
  ];

  return (
    <div className="space-y-8">
      <section aria-labelledby="glance-h" className="space-y-3">
        <h2 id="glance-h" className="text-2xl font-bold">{season.name}</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Riders registered" value={dash.riders} />
          <Stat label="Signed the current waiver" value={dash.waiver_signers} />
          <Stat label="Race entries taken" value={formatCents(raceRevenue)} />
          <Stat label="Season passes" value={dash.season_passes} />
          <Stat label="Season pass sales" value={formatCents(dash.season_pass_revenue_cents)} />
          <Stat label="Online payments" value={settings.payments_enabled === false ? "Off" : "On"} />
        </dl>
        <p className="text-sm text-muted-foreground">Money taken counts confirmed registrations, online and at the desk. Refunds made in Stripe aren&apos;t subtracted.</p>
      </section>

      <section aria-labelledby="setup-h" className="space-y-3">
        <h2 id="setup-h" className="text-2xl font-bold">Setup</h2>
        <ul className="space-y-2">
          {todos.map((t) => (
            <li key={t.text} className="flex items-start gap-2">
              {t.done ? (
                <CircleCheck aria-hidden="true" className="mt-3 size-5 shrink-0 text-success" />
              ) : (
                <CircleAlert aria-hidden="true" className="mt-3 size-5 shrink-0 text-destructive" />
              )}
              <p className="py-2.5">
                <span className="sr-only">{t.done ? "Done:" : "To do:"}</span>
                {t.text}{" "}
                {/* Inline padding widens the tap target to 44px without breaking the line. */}
                <Link href={t.href} className="whitespace-nowrap py-2.5 font-semibold text-primary underline">
                  {t.link}
                </Link>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="next-h" className="space-y-3">
        <h2 id="next-h" className="text-2xl font-bold">Coming up</h2>
        {upcoming.length === 0 ? <p>No upcoming events.</p> : null}
        <ul className="space-y-2">
          {upcoming.map((e) => (
            <li key={e.id}>
              <Card className="space-y-1">
                <p className="font-bold">
                  <Link href={`/admin/events/${e.id}`} className="text-primary underline">
                    {e.name}, {formatEventDate(e.event_date, "short")}
                  </Link>{" "}
                  <EventStatusBadge status={e.status} />
                </p>
                <p className="text-sm">
                  {e.confirmed} of {e.capacity} confirmed
                  {e.pending_payment ? ` · ${e.pending_payment} awaiting payment` : ""}
                  {e.waitlisted ? ` · ${e.waitlisted} waitlisted` : ""}
                </p>
              </Card>
            </li>
          ))}
        </ul>
        <p>
          <Link href={`/admin/events?season=${season.id}`} className="font-semibold text-primary underline">All events in {season.name}</Link>
        </p>
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Admin</h1>
      <Suspense fallback={<PageLoading label="Loading the dashboard" />}>
        <Dashboard />
      </Suspense>
    </div>
  );
}
