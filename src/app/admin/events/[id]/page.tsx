import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEventFormOptions } from "@/lib/admin/data";
import { UUID_RE } from "@/lib/admin/server";
import { centsToDollars, formatEventDate, utcToEasternLocal } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { Alert } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { AdminForm } from "@/components/admin/admin-form";
import { CheckboxField, TextField } from "@/components/admin/fields";
import { EventForm, type CategoryRow } from "@/components/admin/event-form";
import { copyEvent, deleteEvent } from "../actions";

export const metadata: Metadata = { title: "Edit event" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; copied?: string }> };

type EventRow = {
  id: string;
  season_id: string;
  venue_id: string;
  name: string;
  event_date: string;
  registration_opens_at: string;
  registration_closes_at: string;
  status: "draft" | "published" | "canceled" | "completed";
  notes: string;
  event_categories: {
    id: string;
    category_id: string;
    start_at: string;
    duration_minutes: number;
    laps: number | null;
    capacity: number;
    price_cents: number;
    walk_up_price_cents: number;
  }[];
};

function nextWeek(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

/** "Race 4" becomes "Race 5"; other names get " (copy)". */
function nextName(name: string): string {
  const m = /^(.*?)(\d+)$/.exec(name);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${name} (copy)`;
}

async function Edit({ params, searchParams }: Props) {
  const { id } = await params;
  const { created, copied } = await searchParams;
  await requireAdmin(`/admin/events/${id}`);
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();
  const [{ data }, options, { data: regs }] = await Promise.all([
    supabase
      .from("events")
      .select(
        "id, season_id, venue_id, name, event_date, registration_opens_at, registration_closes_at, status, notes, event_categories(id, category_id, start_at, duration_minutes, laps, capacity, price_cents, walk_up_price_cents)",
      )
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    getEventFormOptions(supabase),
    supabase.rpc("admin_dashboard_event_counts", { p_event_id: id }),
  ]);
  if (!data) notFound();
  const ev = data as unknown as EventRow;
  const counts = new Map(((regs ?? []) as { event_category_id: string; registrations: number }[]).map((r) => [r.event_category_id, r.registrations]));

  const rows: CategoryRow[] = [...ev.event_categories]
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map((c) => ({
      id: c.id,
      category_id: c.category_id,
      start_time: utcToEasternLocal(c.start_at).slice(11),
      duration_minutes: String(c.duration_minutes),
      laps: c.laps === null ? "" : String(c.laps),
      capacity: String(c.capacity),
      price: centsToDollars(c.price_cents),
      walk_up_price: centsToDollars(c.walk_up_price_cents),
      registered: counts.get(c.id) ?? 0,
    }));

  return (
    <div className="space-y-8">
      {created ? <Alert tone="success">Created {ev.name}. It&apos;s a draft until you publish it.</Alert> : null}
      {copied ? <Alert tone="success">Copied. Check the date, times, and prices, then publish this event.</Alert> : null}
      <p className="text-lg">
        {formatEventDate(ev.event_date)} ·{" "}
        <Link href={`/events/${ev.id}`} className="font-semibold text-primary underline">
          Public page
        </Link>{" "}
        ·{" "}
        <Link href={`/staff/events/${ev.id}`} className="font-semibold text-primary underline">
          Course maps and notes
        </Link>
      </p>

      <EventForm
        values={{
          id: ev.id,
          season_id: ev.season_id,
          venue_id: ev.venue_id,
          name: ev.name,
          event_date: ev.event_date,
          registration_opens_at: utcToEasternLocal(ev.registration_opens_at),
          registration_closes_at: utcToEasternLocal(ev.registration_closes_at),
          status: ev.status,
          notes: ev.notes,
          categories: rows,
        }}
        seasons={options.seasons}
        venues={options.venues}
        categories={options.categories}
        blankRow={{
          start_time: "18:00",
          duration_minutes: "40",
          laps: "",
          capacity: String(options.defaults.capacity),
          price: centsToDollars(options.defaults.priceCents),
          walk_up_price: centsToDollars(options.defaults.walkUpPriceCents),
        }}
      />

      <section aria-labelledby="exports-h" className="space-y-3">
        <h2 id="exports-h" className="text-2xl font-bold">Lists</h2>
        <div className="flex flex-wrap gap-2">
          <a href={`/admin/export/registrations?event=${ev.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Registrations (CSV)
          </a>
          <Link href={`/staff/events/${ev.id}/emergency`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Emergency contact sheet
          </Link>
          <a href={`/staff/events/${ev.id}/start-list?format=pdf`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Start list (PDF)
          </a>
        </div>
      </section>

      <section aria-labelledby="copy-h" className="space-y-3">
        <h2 id="copy-h" className="text-2xl font-bold">Copy to another date</h2>
        <p>The copy is a draft with the same categories, start times, prices, and capacities. The registration window moves with the date.</p>
        <AdminForm action={copyEvent} submitLabel="Copy event">
          <input type="hidden" name="source_id" value={ev.id} />
          <TextField id="copy-name" name="name" label="Name of the copy" defaultValue={nextName(ev.name)} required minLength={2} />
          <TextField id="copy-date" name="event_date" label="Date" type="date" defaultValue={nextWeek(ev.event_date)} required />
        </AdminForm>
      </section>

      <section aria-labelledby="delete-h" className="space-y-3">
        <h2 id="delete-h" className="text-2xl font-bold">Delete</h2>
        <p>Only an event nobody has registered for can be deleted. To call off a race riders have registered for, set its status to canceled.</p>
        <AdminForm action={deleteEvent} submitLabel="Delete event" pendingLabel="Deleting…" variant="destructive">
          <input type="hidden" name="id" value={ev.id} />
          <input type="hidden" name="season_id" value={ev.season_id} />
          <CheckboxField id="delete-confirm" name="confirm" label={`Delete ${ev.name}`} required />
        </AdminForm>
      </section>
    </div>
  );
}

export default function Page(props: Props) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Edit event</h1>
      <Suspense fallback={<PageLoading label="Loading event" />}>
        <Edit {...props} />
      </Suspense>
    </div>
  );
}
