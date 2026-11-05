import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getStandings, type CategoryStandings } from "@/lib/results-data";
import { formatEventDate } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { SetupNotice } from "@/components/setup-notice";
import { isSupabaseConfigured } from "@/lib/env";
import { ScrollRegion } from "@/components/ui/scroll-region";

export const metadata: Metadata = { title: "Series standings" };

const STATUS_LABEL = { finished: "", DNF: "DNF", DNS: "DNS", DQ: "DQ" } as const;

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function CategoryTable({ cat }: { cat: CategoryStandings }) {
  const names = new Map(cat.events.map((e, i) => [e.id, { short: `R${i + 1}`, full: `${e.name}, ${formatEventDate(e.event_date, "short")}` }]));
  const id = `cat-${slug(cat.categoryName)}`;
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 id={id} className="text-2xl font-bold">{cat.categoryName}</h2>
      <p className="text-sm text-muted-foreground">
        {cat.events.length} {cat.events.length === 1 ? "race" : "races"} scored.
      </p>
      <ScrollRegion label={`${cat.categoryName} standings`}>
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{cat.categoryName} standings</caption>
          <thead>
            <tr className="border-b-2 border-border">
              <th scope="col" className="p-2">Rank</th>
              <th scope="col" className="p-2">Rider</th>
              <th scope="col" className="p-2 text-right">Wins</th>
              <th scope="col" className="p-2 text-right">Points</th>
            </tr>
          </thead>
          <tbody>
            {cat.rows.map((r) => (
              <tr key={r.riderId} className="border-b border-border align-top" data-rider-id={r.riderId}>
                <td className="p-2 font-semibold">{r.tied ? `T${r.rank}` : r.rank}</td>
                <td className="p-2">
                  <span className="font-semibold">{r.displayName}</span>
                  {r.team ? <span className="block text-sm text-muted-foreground">{r.team}</span> : null}
                  <span className="block text-sm">
                    {r.results.map((s, i) => {
                      const ev = names.get(s.eventId);
                      const place = s.place ?? STATUS_LABEL[s.status];
                      return (
                        <span key={s.eventId} className={s.dropped ? "text-muted-foreground line-through" : undefined}>
                          {i > 0 ? " · " : ""}
                          <abbr title={ev?.full} className="no-underline">{ev?.short}</abbr>: {s.points}
                          {place !== "" ? ` (${typeof place === "number" ? ordinal(place) : place})` : ""}
                          {s.dropped ? <span className="sr-only"> (dropped)</span> : null}
                        </span>
                      );
                    })}
                  </span>
                </td>
                <td className="p-2 text-right">{r.wins}</td>
                <td className="p-2 text-right text-lg font-bold">{r.totalPoints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </section>
  );
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

async function Standings() {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  // Render per request, so a publish shows on the next visit. The data itself
  // is still cached and shared (tag "results"); a prerendered copy would be
  // served stale once after each publish.
  await connection();
  const data = await getStandings();
  if (!data) return <p>There&apos;s no active season yet.</p>;
  return (
    <div className="space-y-6">
      <p className="text-lg">{data.season.name}</p>
      <p>
        Points from each race&apos;s published results.
        {data.dropWorstN > 0
          ? ` Each rider's worst ${data.dropWorstN === 1 ? "race is" : `${data.dropWorstN} races are`} dropped (missed races count as dropped first); dropped scores are crossed out.`
          : ""}{" "}
        Ties go to the rider with more wins, then to the better place in the most recent race.
      </p>
      {data.categories.length ? (
        <>
          <nav aria-label="Categories" className="flex flex-wrap gap-x-4 font-semibold">
            {data.categories.map((c) => (
              <a key={c.categoryId} href={`#cat-${slug(c.categoryName)}`} className="inline-flex min-h-11 min-w-11 items-center text-primary underline">
                {c.categoryName}
              </a>
            ))}
          </nav>
          {data.categories.map((c) => <CategoryTable key={c.categoryId} cat={c} />)}
        </>
      ) : (
        <p>No results have been published yet. Check back after the first race.</p>
      )}
      <p>
        Race-by-race results are on each event&apos;s page. See the{" "}
        <Link href="/schedule" className="font-semibold text-primary underline">schedule</Link>.
      </p>
    </div>
  );
}

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Series standings</h1>
      <Suspense fallback={<PageLoading label="Loading the standings" />}>
        <Standings />
      </Suspense>
    </div>
  );
}
