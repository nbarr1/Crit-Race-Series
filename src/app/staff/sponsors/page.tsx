import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageLoading } from "@/components/page-loading";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SponsorLogo } from "@/components/event/sponsor-strip";
import { SponsorForm } from "@/components/staff/sponsor-form";
import { setSponsorActive } from "./actions";
import type { Sponsor } from "@/lib/types";

export const metadata: Metadata = { title: "Manage sponsors" };

async function Manage() {
  await requireStaff("/staff/sponsors");
  const supabase = await createClient();
  const { data } = await supabase
    .from("sponsors")
    .select("id, name, logo_path, url, tier, sort_order, is_active")
    .is("deleted_at", null)
    .order("sort_order");
  const sponsors = (data ?? []) as Sponsor[];
  return (
    <div className="space-y-6">
      <ul className="space-y-2">
        {sponsors.map((s) => (
          <li key={s.id}>
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <SponsorLogo sponsor={s} />
              <span>
                <span className="font-bold">{s.name}</span> · {s.tier} · order {s.sort_order}{" "}
                {s.is_active ? <Badge tone="success">Showing</Badge> : <Badge>Hidden</Badge>}
              </span>
              <form action={setSponsorActive}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="active" value={s.is_active ? "false" : "true"} />
                <Button type="submit" variant="secondary" size="sm">{s.is_active ? "Hide" : "Show"}</Button>
              </form>
            </Card>
          </li>
        ))}
      </ul>
      <section aria-labelledby="add-s" className="space-y-3">
        <h2 id="add-s" className="text-2xl font-bold">Add a sponsor</h2>
        <SponsorForm />
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Sponsors</h1>
      <Suspense fallback={<PageLoading label="Loading" />}>
        <Manage />
      </Suspense>
    </div>
  );
}
