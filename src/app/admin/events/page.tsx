import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDashboard, pickSeason } from "@/lib/admin/data";
import { formatCents, formatEventDate } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { EventStatusBadge } from "@/components/admin/status";

export const metadata: Metadata = { title: "Events and prices" };

type Props = { searchParams: Promise<{ season?: string }> };

async function Events({ searchParams }: Props) {
  await requireAdmin("/admin/events");
  const { season: requested } = await searchParams;
  const supabase = await createClient();
  const { seasons, season } = await pickSeason(supabase, requested);
  if (!season) {
    return (
      <p>
        There are no seasons yet.{" "}
        <Link href="/admin/seasons" className="font-semibold text-primary underline">
          Create a season
        </Link>{" "}
        first.
      </p>
    );
  }
  const dash = await getDashboard(supabase, season.id);
  const events = dash?.events ?? [];

  return (
    <div className="space-y-6">
      {seasons.length > 1 ? (
        <nav aria-label="Seasons">
          <ul className="flex flex-wrap gap-2">
            {seasons.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/admin/events?season=${s.id}`}
                  aria-current={s.id === season.id ? "page" : undefined}
                  className={buttonVariants({ variant: s.id === season.id ? "default" : "secondary", size: "sm" })}
                >
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-bold">
          {season.name} {season.is_active ? <Badge tone="success">Active</Badge> : <Badge>Not active</Badge>}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/events/new?season=${season.id}`} className={buttonVariants({ size: "sm" })}>
            Add an event
          </Link>
          <a href={`/admin/export/registrations?season=${season.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Export registrations (CSV)
          </a>
        </div>
      </div>
      {events.length === 0 ? <p>No events in this season yet. Add the first one, then copy it to the other dates.</p> : null}
      <ul className="space-y-3">
        {events.map((e) => (
          <li key={e.id}>
            <Card className="space-y-1">
              <h3 className="text-xl font-bold">
                <Link href={`/admin/events/${e.id}`} className="text-primary underline">
                  {e.name}, {formatEventDate(e.event_date, "short")}
                </Link>{" "}
                <EventStatusBadge status={e.status} />
              </h3>
              <p className="text-sm">
                {e.categories} {e.categories === 1 ? "category" : "categories"} · {e.confirmed} of {e.capacity} spots confirmed
                {e.pending_payment ? ` · ${e.pending_payment} awaiting payment` : ""}
                {e.waitlisted ? ` · ${e.waitlisted} waitlisted` : ""} · {formatCents(e.revenue_cents)} taken
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Page(props: Props) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Events and prices</h1>
      <Suspense fallback={<PageLoading label="Loading events" />}>
        <Events {...props} />
      </Suspense>
    </div>
  );
}
