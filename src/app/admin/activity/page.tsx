import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { changedFields, TABLE_LABELS } from "@/lib/admin/audit";
import { formatDateTime } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { ScrollRegion } from "@/components/ui/scroll-region";

export const metadata: Metadata = { title: "Activity log" };

type Entry = {
  id: string;
  actor_profile_id: string | null;
  action: "insert" | "update" | "delete";
  table_name: string;
  row_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
};
type Props = { searchParams: Promise<{ table?: string }> };

const ACTIONS = { insert: "added", update: "changed", delete: "removed" } as const;

async function Activity({ searchParams }: Props) {
  await requireAdmin("/admin/activity");
  const { table } = await searchParams;
  const filter = table && table in TABLE_LABELS ? table : null;
  const supabase = await createClient();
  let query = supabase
    .from("audit_log")
    .select("id, actor_profile_id, action, table_name, row_id, before_data, after_data, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter) query = query.eq("table_name", filter);
  const { data } = await query;
  const entries = (data ?? []) as Entry[];
  const actorIds = [...new Set(entries.map((e) => e.actor_profile_id).filter((x): x is string => Boolean(x)))];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, first_name, last_name").in("id", actorIds)
    : { data: [] };
  const names = new Map(((actors ?? []) as { id: string; first_name: string; last_name: string }[]).map((a) => [a.id, `${a.first_name} ${a.last_name}`.trim()]));

  return (
    <div className="space-y-4">
      <nav aria-label="Filter by kind">
        <ul className="flex flex-wrap gap-x-3 text-sm">
          <li>
            <Link href="/admin/activity" aria-current={!filter ? "page" : undefined} className="inline-flex min-h-11 items-center font-semibold text-primary underline">
              Everything
            </Link>
          </li>
          {Object.entries(TABLE_LABELS).map(([key, label]) => (
            <li key={key}>
              <Link
                href={`/admin/activity?table=${key}`}
                aria-current={filter === key ? "page" : undefined}
                className="inline-flex min-h-11 items-center font-semibold text-primary underline"
              >
                {label}s
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {entries.length === 0 ? <p>Nothing recorded yet.</p> : null}
      <ScrollRegion label="Recent changes">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">The 100 most recent changes{filter ? ` to ${TABLE_LABELS[filter].toLowerCase()}s` : ""}</caption>
          <thead>
            <tr className="border-b-2 border-border">
              <th scope="col" className="py-2 pr-3">When</th>
              <th scope="col" className="py-2 pr-3">Who</th>
              <th scope="col" className="py-2 pr-3">What</th>
              <th scope="col" className="py-2">Fields</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-border align-top">
                <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(e.created_at)}</td>
                <td className="py-2 pr-3">{e.actor_profile_id ? names.get(e.actor_profile_id) || "A staff member" : "The system"}</td>
                <td className="py-2 pr-3">
                  {TABLE_LABELS[e.table_name] ?? e.table_name} {ACTIONS[e.action]}
                </td>
                <td className="py-2 break-words">{changedFields(e.before_data, e.after_data).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </div>
  );
}

export default function Page(props: Props) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Activity log</h1>
      <p>Every change by staff and admins, newest first. The log can&apos;t be edited.</p>
      <Suspense fallback={<PageLoading label="Loading activity" />}>
        <Activity {...props} />
      </Suspense>
    </div>
  );
}
