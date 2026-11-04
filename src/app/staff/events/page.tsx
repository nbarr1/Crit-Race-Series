import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEventDate } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Events" };

async function List() {
  await requireStaff("/staff/events");
  const supabase = await createClient();
  const { data: season } = await supabase.from("seasons").select("id").eq("is_active", true).maybeSingle();
  if (!season) return <p>There&apos;s no active season.</p>;
  const { data } = await supabase
    .from("events")
    .select("id, name, event_date, status")
    .eq("season_id", (season as { id: string }).id)
    .is("deleted_at", null)
    .order("event_date");
  return (
    <ul className="space-y-1">
      {((data ?? []) as { id: string; name: string; event_date: string; status: string }[]).map((e) => (
        <li key={e.id}>
          <Link href={`/staff/events/${e.id}`} className="inline-flex min-h-11 items-center text-primary underline">
            {e.name}, {formatEventDate(e.event_date, "short")}
            {e.status !== "published" ? ` (${e.status})` : ""}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Event information</h1>
      <Suspense fallback={<PageLoading label="Loading" />}>
        <List />
      </Suspense>
    </div>
  );
}
