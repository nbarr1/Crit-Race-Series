import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEventDate, todayInDisplayTz } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { Badge, Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Results" };

type Ev = {
  id: string;
  name: string;
  event_date: string;
  status: string;
  event_categories: { id: string; categories: { name: string; sort_order: number } }[];
};

async function List() {
  await requireStaff("/staff/results");
  const supabase = await createClient();
  const { data: season } = await supabase.from("seasons").select("id").eq("is_active", true).maybeSingle();
  if (!season) return <p>There&apos;s no active season.</p>;
  const { data } = await supabase
    .from("events")
    .select("id, name, event_date, status, event_categories(id, categories(name, sort_order))")
    .eq("season_id", (season as { id: string }).id)
    .is("deleted_at", null)
    .neq("status", "draft")
    .order("event_date");
  const events = (data ?? []) as unknown as Ev[];
  const today = todayInDisplayTz();

  // Result counts per category, a page at a time (responses cap at 1,000 rows).
  const ecIds = events.flatMap((e) => e.event_categories.map((ec) => ec.id));
  const counts = new Map<string, { total: number; published: number }>();
  for (let from = 0; ecIds.length; from += 1000) {
    const { data: rows } = await supabase
      .from("results")
      .select("id, event_category_id, is_published")
      .in("event_category_id", ecIds)
      .order("id")
      .range(from, from + 999);
    const list = (rows ?? []) as { event_category_id: string; is_published: boolean }[];
    for (const r of list) {
      const c = counts.get(r.event_category_id) ?? { total: 0, published: 0 };
      c.total++;
      if (r.is_published) c.published++;
      counts.set(r.event_category_id, c);
    }
    if (list.length < 1000) break;
  }

  // Past and today's races first (most recent at the top), then upcoming ones.
  const past = events.filter((e) => e.event_date <= today).reverse();
  const upcoming = events.filter((e) => e.event_date > today);

  const render = (list: Ev[]) => (
    <ul className="space-y-3">
      {list.map((e) => (
        <li key={e.id}>
          <Card className="space-y-2">
            <h3 className="text-xl font-bold">
              {e.name}, {formatEventDate(e.event_date, "short")}
              {e.status === "canceled" ? " (canceled)" : ""}
            </h3>
            <ul className="space-y-1">
              {[...e.event_categories]
                .sort((a, b) => a.categories.sort_order - b.categories.sort_order)
                .map((ec) => {
                  const c = counts.get(ec.id);
                  return (
                    <li key={ec.id} className="flex flex-wrap items-center gap-2">
                      <Link href={`/staff/results/${ec.id}`} className="inline-flex min-h-11 items-center font-semibold text-primary underline">
                        {ec.categories.name}
                        <span className="sr-only">, {e.name}</span>
                      </Link>
                      {!c ? (
                        <Badge>No results</Badge>
                      ) : c.published === c.total ? (
                        <Badge tone="success">Published ({c.total})</Badge>
                      ) : (
                        <Badge tone="warning">Draft ({c.total})</Badge>
                      )}
                    </li>
                  );
                })}
            </ul>
          </Card>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      <section aria-labelledby="past-h" className="space-y-3">
        <h2 id="past-h" className="text-2xl font-bold">Raced</h2>
        {past.length ? render(past) : <p>No races have happened yet this season.</p>}
      </section>
      {upcoming.length ? (
        <section aria-labelledby="upcoming-h" className="space-y-3">
          <h2 id="upcoming-h" className="text-2xl font-bold">Upcoming</h2>
          {render(upcoming)}
        </section>
      ) : null}
    </div>
  );
}

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Results</h1>
      <p>
        Choose a race to upload the officials&apos; results. Saved results stay a draft until you publish them. See the{" "}
        <Link href="/standings" className="font-semibold text-primary underline">series standings</Link>.
      </p>
      <Suspense fallback={<PageLoading label="Loading" />}>
        <List />
      </Suspense>
    </div>
  );
}
