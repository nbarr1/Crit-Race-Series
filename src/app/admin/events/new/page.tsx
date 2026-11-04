import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEventFormOptions, pickSeason } from "@/lib/admin/data";
import { centsToDollars, utcToEasternLocal } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { EventForm, type CategoryRow } from "@/components/admin/event-form";

export const metadata: Metadata = { title: "Add an event" };

type Props = { searchParams: Promise<{ season?: string }> };

type TemplateCategory = {
  category_id: string;
  start_at: string;
  duration_minutes: number;
  laps: number | null;
  capacity: number;
  price_cents: number;
  walk_up_price_cents: number;
};

async function NewEvent({ searchParams }: Props) {
  await requireAdmin("/admin/events/new");
  const { season: requested } = await searchParams;
  const supabase = await createClient();
  const [{ season }, options] = await Promise.all([pickSeason(supabase, requested), getEventFormOptions(supabase)]);
  if (!season) {
    return (
      <p>
        <Link href="/admin/seasons" className="font-semibold text-primary underline">Create a season</Link> first.
      </p>
    );
  }
  if (options.venues.length === 0) {
    return (
      <p>
        <Link href="/admin/venues" className="font-semibold text-primary underline">Add a venue</Link> first.
      </p>
    );
  }

  // Start from the season's latest event, so a new race gets the usual
  // categories, times, and prices. Without one, list every category with the
  // default capacity and prices from the settings.
  const { data: last } = await supabase
    .from("events")
    .select("id, venue_id, event_categories(category_id, start_at, duration_minutes, laps, capacity, price_cents, walk_up_price_cents)")
    .eq("season_id", season.id)
    .is("deleted_at", null)
    .order("event_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const template = last as { venue_id: string; event_categories: TemplateCategory[] } | null;
  const blankRow = {
    start_time: "18:00",
    duration_minutes: "40",
    laps: "",
    capacity: String(options.defaults.capacity),
    price: centsToDollars(options.defaults.priceCents),
    walk_up_price: centsToDollars(options.defaults.walkUpPriceCents),
  };
  const rows: CategoryRow[] = template?.event_categories.length
    ? template.event_categories
        .sort((a, b) => a.start_at.localeCompare(b.start_at))
        .map((c) => ({
          category_id: c.category_id,
          start_time: utcToEasternLocal(c.start_at).slice(11),
          duration_minutes: String(c.duration_minutes),
          laps: c.laps === null ? "" : String(c.laps),
          capacity: String(c.capacity),
          price: centsToDollars(c.price_cents),
          walk_up_price: centsToDollars(c.walk_up_price_cents),
        }))
    : options.categories.map((c) => ({ ...blankRow, category_id: c.id }));

  return (
    <>
      <p>
        New events start as a draft, so riders don&apos;t see them until you publish.
        {template ? " The categories, times, and prices come from the season's latest event." : ""}
      </p>
      <EventForm
        values={{
          season_id: season.id,
          venue_id: template?.venue_id ?? options.venues[0].id,
          name: "",
          event_date: "",
          registration_opens_at: "",
          registration_closes_at: "",
          status: "draft",
          notes: "",
          categories: rows,
        }}
        seasons={options.seasons}
        venues={options.venues}
        categories={options.categories}
        blankRow={blankRow}
      />
    </>
  );
}

export default function Page(props: Props) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Add an event</h1>
      <Suspense fallback={<PageLoading label="Loading" />}>
        <NewEvent {...props} />
      </Suspense>
    </div>
  );
}
