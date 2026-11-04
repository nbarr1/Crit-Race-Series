import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import Link from "next/link";
import { requireRider } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEventDate, formatTime } from "@/lib/time";
import { Badge, Card } from "@/components/ui/card";
import type { RegistrationStatus } from "@/lib/types";

export const metadata: Metadata = { title: "My races" };

type Row = {
  id: string;
  status: RegistrationStatus;
  bib_number: number | null;
  checked_in_at: string | null;
  event_categories: {
    start_at: string;
    categories: { name: string };
    events: { id: string; name: string; event_date: string };
  };
};

const STATUS_LABEL: Record<RegistrationStatus, string> = {
  pending_payment: "Payment pending",
  confirmed: "Confirmed",
  waitlisted: "Waitlisted",
  canceled: "Canceled",
  refunded: "Refunded",
};

async function MyRaces() {
  const profile = await requireRider("/my-races");
  const supabase = await createClient();
  const { data } = await supabase
    .from("registrations")
    .select("id, status, bib_number, checked_in_at, event_categories(start_at, categories(name), events(id, name, event_date))")
    .eq("rider_id", profile.id)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">My races</h1>
      <p>Hi, {profile.first_name}.</p>
      {rows.length === 0 ? (
        <p>
          You haven&apos;t registered for any races yet.{" "}
          <Link href="/schedule" className="font-semibold text-primary underline">
            See the schedule
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="space-y-1">
                <h2 className="text-xl font-bold">
                  <Link className="underline" href={`/events/${r.event_categories.events.id}`}>
                    {r.event_categories.events.name}
                  </Link>
                </h2>
                <p>
                  {r.event_categories.categories.name} · {formatEventDate(r.event_categories.events.event_date, "short")},{" "}
                  {formatTime(r.event_categories.start_at)}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={r.status === "confirmed" ? "success" : r.status === "waitlisted" ? "warning" : "neutral"}>
                    {STATUS_LABEL[r.status]}
                  </Badge>
                  {r.bib_number ? <Badge>Bib {r.bib_number}</Badge> : null}
                  {r.checked_in_at ? <Badge tone="success">Checked in</Badge> : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PageLoading label="Loading your races" />}>
        <MyRaces />
      </Suspense>
  );
}
