import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEventDate, todayInDisplayTz } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { CheckInApp } from "@/components/check-in/check-in-app";
import { pickEvent } from "@/lib/offline/check-in-queue";

export const metadata: Metadata = { title: "Check-in" };

type Props = { searchParams: Promise<{ event?: string }> };
type Ev = { id: string; name: string; event_date: string; status: string };

async function CheckIn({ searchParams }: Props) {
  const { event: requested } = await searchParams;
  await requireStaff("/staff/check-in");
  const supabase = await createClient();
  const { data: season } = await supabase.from("seasons").select("id").eq("is_active", true).maybeSingle();
  if (!season) return <p>There&apos;s no active season.</p>;
  const { data } = await supabase
    .from("events")
    .select("id, name, event_date, status")
    .eq("season_id", (season as { id: string }).id)
    .in("status", ["published", "completed"])
    .is("deleted_at", null)
    .order("event_date");
  const events = (data ?? []) as Ev[];
  const event = pickEvent(events, todayInDisplayTz(), requested);
  if (!event) return <p>No events to check in yet.</p>;

  const { data: cats } = await supabase
    .from("event_categories")
    .select("id, walk_up_price_cents, categories(name, sort_order)")
    .eq("event_id", event.id);
  const categories = ((cats ?? []) as unknown as { id: string; walk_up_price_cents: number; categories: { name: string; sort_order: number } }[])
    .sort((a, b) => a.categories.sort_order - b.categories.sort_order)
    .map((c) => ({ id: c.id, name: c.categories.name, walk_up_price_cents: c.walk_up_price_cents }));

  return (
    <div className="space-y-4">
      <CheckInApp eventId={event.id} eventName={`${event.name}, ${formatEventDate(event.event_date, "short")}`} categories={categories} />
      <details className="rounded-lg border-2 border-border p-3">
        <summary className="min-h-11 cursor-pointer content-center font-semibold">Switch to another event</summary>
        <ul className="mt-2 space-y-1">
          {events.map((e) => (
            <li key={e.id}>
              <Link href={`/staff/check-in?event=${e.id}`} className="inline-flex min-h-11 items-center text-primary underline" aria-current={e.id === event.id ? "page" : undefined}>
                {e.name}, {formatEventDate(e.event_date, "short")}
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export default function Page({ searchParams }: Props) {
  return (
    <Suspense fallback={<PageLoading label="Loading check-in" />}>
      <CheckIn searchParams={searchParams} />
    </Suspense>
  );
}
