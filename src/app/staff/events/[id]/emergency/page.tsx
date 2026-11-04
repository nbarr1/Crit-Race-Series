import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ageOn, formatEventDate } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { PrintButton } from "@/components/staff/print-button";

export const metadata: Metadata = { title: "Emergency contacts", robots: { index: false } };

type Props = { params: Promise<{ id: string }> };

type Row = {
  rider_id: string;
  bib_number: number | null;
  status: string;
  checked_in_at: string | null;
  rider: {
    first_name: string;
    last_name: string;
    phone: string | null;
    birth_date: string | null;
    emergency_contact_name: string | null;
    emergency_contact_relationship: string | null;
    emergency_contact_phone: string | null;
  };
  event_categories: { categories: { name: string } };
};

/**
 * Emergency contacts for an event's riders, for the first-aid table and the
 * officials. Read online only: it's never cached on the device (D-074).
 */
async function Sheet({ params }: Props) {
  const { id } = await params;
  await requireStaff(`/staff/events/${id}/emergency`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: event }, { data }] = await Promise.all([
    supabase.from("events").select("name, event_date").eq("id", id).maybeSingle(),
    supabase
      .from("registrations")
      .select(
        "rider_id, bib_number, status, checked_in_at, rider:profiles!registrations_rider_id_fkey(first_name, last_name, phone, birth_date, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone), event_categories(categories(name))",
      )
      .eq("event_id", id)
      .in("status", ["confirmed", "pending_payment"]),
  ]);
  if (!event) notFound();
  const ev = event as { name: string; event_date: string };
  // One line per rider, even when they race two categories.
  const byRider = new Map<string, Row & { categories: string[] }>();
  for (const r of (data ?? []) as unknown as Row[]) {
    const key = r.rider_id;
    const existing = byRider.get(key);
    if (existing) {
      existing.categories.push(r.event_categories.categories.name);
      existing.bib_number ??= r.bib_number;
      existing.checked_in_at ??= r.checked_in_at;
    } else byRider.set(key, { ...r, categories: [r.event_categories.categories.name] });
  }
  const rows = [...byRider.values()].sort(
    (a, b) => a.rider.last_name.localeCompare(b.rider.last_name) || a.rider.first_name.localeCompare(b.rider.first_name),
  );

  return (
    <div className="space-y-4">
      <p className="text-lg">
        {ev.name}, {formatEventDate(ev.event_date)} · {rows.length} riders
      </p>
      <p className="print:hidden">
        Confidential. Shred printed copies after the race.{" "}
        <Link href={`/staff/events/${id}`} className="font-semibold text-primary underline">Back to the event</Link>
      </p>
      <PrintButton />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm print:text-xs">
          <caption className="sr-only">Emergency contacts for {ev.name}, by last name</caption>
          <thead>
            <tr className="border-b-2 border-border">
              <th scope="col" className="py-2 pr-2">Rider</th>
              <th scope="col" className="py-2 pr-2">Bib</th>
              <th scope="col" className="py-2 pr-2">Category</th>
              <th scope="col" className="py-2 pr-2">Rider phone</th>
              <th scope="col" className="py-2 pr-2">Emergency contact</th>
              <th scope="col" className="py-2">Contact phone</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const minor = r.rider.birth_date ? ageOn(r.rider.birth_date, ev.event_date) < 18 : false;
              return (
                <tr key={r.rider_id} className="border-b border-border align-top">
                  <th scope="row" className="py-2 pr-2 font-semibold">
                    {r.rider.last_name}, {r.rider.first_name}
                    {minor ? <span className="block font-normal">Under 18</span> : null}
                  </th>
                  <td className="py-2 pr-2">{r.bib_number ?? ""}</td>
                  <td className="py-2 pr-2">{r.categories.join(", ")}</td>
                  <td className="py-2 pr-2 whitespace-nowrap">{r.rider.phone ? <a href={`tel:${r.rider.phone}`} className="underline">{r.rider.phone}</a> : "None given"}</td>
                  <td className="py-2 pr-2">
                    {r.rider.emergency_contact_name || "None given"}
                    {r.rider.emergency_contact_relationship ? ` (${r.rider.emergency_contact_relationship})` : ""}
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    {r.rider.emergency_contact_phone ? (
                      <a href={`tel:${r.rider.emergency_contact_phone}`} className="font-semibold underline">{r.rider.emergency_contact_phone}</a>
                    ) : (
                      "None given"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Page(props: Props) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Emergency contacts</h1>
      <Suspense fallback={<PageLoading label="Loading contacts" />}>
        <Sheet {...props} />
      </Suspense>
    </div>
  );
}
