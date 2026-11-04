import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { pointsToText } from "@/lib/admin/points";
import { PageLoading } from "@/components/page-loading";
import { Card } from "@/components/ui/card";
import { AdminForm } from "@/components/admin/admin-form";
import { TextAreaField, TextField } from "@/components/admin/fields";
import { savePoints } from "./actions";

export const metadata: Metadata = { title: "Points" };

type Rules = { id: string; name: string; points_by_place: Record<string, number>; drop_worst_n: number };

function RulesFields({ r }: { r?: Rules }) {
  const p = r?.id ?? "new";
  return (
    <>
      <input type="hidden" name="id" value={r?.id ?? ""} />
      <TextField id={`${p}-name`} name="name" label="Name" defaultValue={r?.name ?? ""} required minLength={2} />
      <TextAreaField
        id={`${p}-points`}
        name="points"
        label="Points by place"
        hint="One number per place, starting with first, separated by commas. Places past the end of the list score 0, as do DNF, DNS, and DQ."
        rows={3}
        defaultValue={r ? pointsToText(r.points_by_place) : "25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1"}
        required
      />
      <TextField
        id={`${p}-drop`}
        name="drop_worst_n"
        label="Dropped races"
        hint="How many of each rider's lowest scores (including missed races) don't count. Use 0 to count every race."
        type="number"
        inputMode="numeric"
        min={0}
        max={20}
        defaultValue={r?.drop_worst_n ?? 0}
        required
      />
    </>
  );
}

async function Points() {
  await requireAdmin("/admin/points");
  const supabase = await createClient();
  const [{ data }, { data: seasons }] = await Promise.all([
    supabase.from("points_rules").select("id, name, points_by_place, drop_worst_n").order("created_at"),
    supabase.from("seasons").select("name, points_rules_id"),
  ]);
  const rules = (data ?? []) as Rules[];
  const usedBy = (id: string) => ((seasons ?? []) as { name: string; points_rules_id: string | null }[]).filter((s) => s.points_rules_id === id).map((s) => s.name);
  return (
    <div className="space-y-6">
      <p>Saving a points table rescores every result in the seasons that use it, and the standings follow.</p>
      <ul className="space-y-3">
        {rules.map((r) => (
          <li key={r.id}>
            <Card className="space-y-2">
              <h2 className="text-xl font-bold">{r.name}</h2>
              <p className="text-sm">Used by: {usedBy(r.id).join(", ") || "no seasons"}</p>
              <AdminForm action={savePoints} submitLabel="Save and rescore">
                <RulesFields r={r} />
              </AdminForm>
            </Card>
          </li>
        ))}
      </ul>
      <section aria-labelledby="new-rules" className="space-y-3">
        <h2 id="new-rules" className="text-2xl font-bold">Add a points table</h2>
        <AdminForm action={savePoints} submitLabel="Add points table">
          <RulesFields />
        </AdminForm>
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Points</h1>
      <Suspense fallback={<PageLoading label="Loading points tables" />}>
        <Points />
      </Suspense>
    </div>
  );
}
