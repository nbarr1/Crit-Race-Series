import Link from "next/link";
import type { CategoryResults } from "@/lib/results-data";
import { ScrollRegion } from "@/components/ui/scroll-region";

const STATUS_LABEL = { finished: "", DNF: "DNF", DNS: "DNS", DQ: "DQ" } as const;

/** An event's published results, one table per category. */
export function EventResults({ categories }: { categories: CategoryResults[] }) {
  if (!categories.length) return null;
  return (
    <section aria-labelledby="results-heading" className="space-y-4">
      <h2 id="results-heading" className="text-2xl font-bold">Results</h2>
      {categories.map((cat) => (
        <div key={cat.categoryId} className="space-y-2">
          <h3 className="text-xl font-bold">{cat.categoryName}</h3>
          <ScrollRegion label={`${cat.categoryName} results`}>
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">{cat.categoryName} results</caption>
              <thead>
                <tr className="border-b-2 border-border">
                  <th scope="col" className="p-2">Place</th>
                  <th scope="col" className="p-2">Rider</th>
                  <th scope="col" className="p-2 text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {cat.rows.map((r) => (
                  <tr key={r.id} className="border-b border-border">
                    <td className="p-2 font-semibold">{r.place ?? STATUS_LABEL[r.status]}</td>
                    <td className="p-2">
                      {r.display_name}
                      {r.team ? <span className="block text-sm text-muted-foreground">{r.team}</span> : null}
                    </td>
                    <td className="p-2 text-right">{r.points_awarded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </div>
      ))}
      <Link href="/standings" className="inline-flex min-h-11 items-center font-semibold text-primary underline">
        See the series standings
      </Link>
    </section>
  );
}
