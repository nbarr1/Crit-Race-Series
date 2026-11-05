import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEventDate } from "@/lib/time";
import { loadEntrants, loadEventCategory, loadSavedResults } from "@/lib/results-staff";
import { entrantLabel } from "@/lib/results-match";
import { PageLoading } from "@/components/page-loading";
import { Alert, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ResultsUpload } from "@/components/staff/results-upload";
import { setPublished } from "../actions";
import { ScrollRegion } from "@/components/ui/scroll-region";

export const metadata: Metadata = { title: "Upload results" };

type Props = { params: Promise<{ ecId: string }> };

const STATUS_LABEL = { finished: "", DNF: "DNF", DNS: "DNS", DQ: "DQ" } as const;

async function Manage({ params }: Props) {
  const { ecId } = await params;
  await requireStaff(`/staff/results/${ecId}`);
  if (!/^[0-9a-f-]{36}$/i.test(ecId)) notFound();
  const supabase = await createClient();
  const ec = await loadEventCategory(supabase, ecId);
  if (!ec) notFound();
  const [saved, entrants] = await Promise.all([loadSavedResults(supabase, ecId), loadEntrants(supabase, ec.event_id)]);
  const published = saved.length > 0 && saved.every((r) => r.is_published);
  const unmatched = saved.filter((r) => !r.rider_id).length;

  const riderOptions = [...entrants]
    .sort((a, b) =>
      a.eventCategoryId === b.eventCategoryId
        ? `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
        : a.eventCategoryId === ecId ? -1 : b.eventCategoryId === ecId ? 1 : a.categoryName.localeCompare(b.categoryName),
    )
    .map((e) => ({ id: e.riderId, label: e.eventCategoryId === ecId ? entrantLabel(e) : `${entrantLabel(e)}, ${e.categoryName}` }));

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Results: {ec.category.name}</h1>
      <p className="text-lg">
        {ec.event.name}, {formatEventDate(ec.event.event_date)} ·{" "}
        <Link href={`/events/${ec.event.id}`} className="font-semibold text-primary underline">View the public page</Link>
      </p>

      <section aria-labelledby="saved-h" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="saved-h" className="text-2xl font-bold">Saved results</h2>
          {saved.length ? (published ? <Badge tone="success">Published</Badge> : <Badge tone="warning">Draft</Badge>) : null}
        </div>
        {saved.length ? (
          <>
            {unmatched ? (
              <Alert>
                {unmatched === 1 ? "One result isn't" : `${unmatched} results aren't`} matched to a registered rider. They show in
                the race results under the name from the sheet, but don&apos;t count toward series standings.
              </Alert>
            ) : null}
            <ScrollRegion label={`Saved results for ${ec.category.name}`}>
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Saved results for {ec.category.name}</caption>
                <thead>
                  <tr className="border-b-2 border-border">
                    <th scope="col" className="p-2">Place</th>
                    <th scope="col" className="p-2">Rider</th>
                    <th scope="col" className="p-2">Bib</th>
                    <th scope="col" className="p-2 text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {saved.map((r) => (
                    <tr key={r.id} className="border-b border-border">
                      <td className="p-2 font-semibold">{r.place ?? STATUS_LABEL[r.status]}</td>
                      <td className="p-2">
                        {r.rider ? `${r.rider.first_name} ${r.rider.last_name}` : r.raw_name}
                        {!r.rider_id ? <span className="block text-sm text-muted-foreground">Not matched</span> : null}
                      </td>
                      <td className="p-2">{r.bib ?? ""}</td>
                      <td className="p-2 text-right">{r.points_awarded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
            <form action={setPublished}>
              <input type="hidden" name="event_category_id" value={ecId} />
              <input type="hidden" name="publish" value={published ? "false" : "true"} />
              <Button type="submit" size="lg" variant={published ? "secondary" : "default"}>
                {published ? "Unpublish results" : "Publish results"}
              </Button>
            </form>
            <p className="text-sm text-muted-foreground">
              {published
                ? "These results are on the public pages and count toward the standings."
                : "Riders and the public can't see these until you publish them."}
            </p>
          </>
        ) : (
          <p>No results saved for this race yet.</p>
        )}
      </section>

      <section aria-labelledby="upload-h" className="space-y-3">
        <h2 id="upload-h" className="text-2xl font-bold">{saved.length ? "Replace results" : "Upload results"}</h2>
        <p>
          Upload a CSV file or paste the sheet. The first row needs column names: Place, plus Bib or Name (or First and Last).
          Team, Status, Laps, and Time are optional. Mark riders who didn&apos;t finish as DNF, DNS, or DQ in the Place or Status
          column.
        </p>
        {saved.length ? (
          <p className="font-semibold">Saving replaces the results above and takes them off the public pages until you publish again.</p>
        ) : null}
        <ResultsUpload eventCategoryId={ecId} riders={riderOptions} />
      </section>
    </div>
  );
}

export default function Page({ params }: Props) {
  return (
    <div className="space-y-4">
      <p>
        <Link href="/staff/results" className="inline-flex min-h-11 items-center font-semibold text-primary underline">All races</Link>
      </p>
      <Suspense fallback={<PageLoading label="Loading" />}>
        <Manage params={params} />
      </Suspense>
    </div>
  );
}

