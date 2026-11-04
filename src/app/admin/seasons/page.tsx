import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSettingsAdmin } from "@/lib/admin/data";
import { centsToDollars } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { Badge, Card } from "@/components/ui/card";
import { AdminForm } from "@/components/admin/admin-form";
import { SelectField, TextField } from "@/components/admin/fields";
import { activateSeason, saveSeason } from "./actions";

export const metadata: Metadata = { title: "Seasons" };

type Season = {
  id: string;
  name: string;
  year: number;
  is_active: boolean;
  season_pass_price_cents: number | null;
  points_rules_id: string | null;
};
type Rules = { id: string; name: string };

function SeasonFields({ season, rules, defaultPassCents }: { season?: Season; rules: Rules[]; defaultPassCents: number | null }) {
  const p = season?.id ?? "new";
  const pass = season ? season.season_pass_price_cents : defaultPassCents;
  return (
    <>
      <input type="hidden" name="id" value={season?.id ?? ""} />
      <TextField id={`${p}-name`} name="name" label="Name" defaultValue={season?.name ?? ""} required minLength={2} maxLength={120} />
      <TextField
        id={`${p}-year`}
        name="year"
        label="Year"
        type="number"
        inputMode="numeric"
        min={2000}
        max={2100}
        defaultValue={season?.year ?? new Date().getFullYear() + 1}
        required
      />
      <TextField
        id={`${p}-pass`}
        name="season_pass_price"
        label="Season pass price per category, in dollars (optional)"
        hint="Leave blank to not sell a season pass."
        inputMode="decimal"
        defaultValue={pass === null ? "" : centsToDollars(pass)}
      />
      <SelectField id={`${p}-rules`} name="points_rules_id" label="Points table" defaultValue={season?.points_rules_id ?? rules[0]?.id ?? ""}>
        {rules.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </SelectField>
    </>
  );
}

async function Seasons() {
  await requireAdmin("/admin/seasons");
  const supabase = await createClient();
  const [{ data }, { data: rulesData }, settings] = await Promise.all([
    supabase.from("seasons").select("id, name, year, is_active, season_pass_price_cents, points_rules_id").order("year", { ascending: false }),
    supabase.from("points_rules").select("id, name").order("created_at"),
    getSettingsAdmin(supabase),
  ]);
  const seasons = (data ?? []) as Season[];
  const rules = (rulesData ?? []) as Rules[];
  const defaultPass = typeof settings.season_pass_price_cents === "number" ? settings.season_pass_price_cents : null;

  return (
    <div className="space-y-6">
      {seasons.length === 0 ? <p>No seasons yet. Create the first one.</p> : null}
      <ul className="space-y-4">
        {seasons.map((s) => (
          <li key={s.id}>
            <Card className="space-y-3">
              <h2 className="text-2xl font-bold">
                {s.name} {s.is_active ? <Badge tone="success">Active</Badge> : null}
              </h2>
              <p>
                <Link href={`/admin/events?season=${s.id}`} className="font-semibold text-primary underline">
                  Events in {s.name}
                </Link>
              </p>
              <details>
                <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">Edit {s.name}</summary>
                <AdminForm action={saveSeason} submitLabel="Save season" className="pt-2">
                  <SeasonFields season={s} rules={rules} defaultPassCents={defaultPass} />
                </AdminForm>
              </details>
              {!s.is_active ? (
                <AdminForm action={activateSeason} submitLabel={`Make ${s.name} the active season`} variant="secondary">
                  <input type="hidden" name="id" value={s.id} />
                  <p className="text-sm">
                    The active season is the one riders see on the schedule, register for, and see in the standings. Only one season is active.
                  </p>
                </AdminForm>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
      <section aria-labelledby="new-season" className="space-y-3">
        <h2 id="new-season" className="text-2xl font-bold">
          Create a season
        </h2>
        <AdminForm action={saveSeason} submitLabel="Create season">
          <SeasonFields rules={rules} defaultPassCents={defaultPass} />
        </AdminForm>
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Seasons</h1>
      <Suspense fallback={<PageLoading label="Loading seasons" />}>
        <Seasons />
      </Suspense>
    </div>
  );
}
