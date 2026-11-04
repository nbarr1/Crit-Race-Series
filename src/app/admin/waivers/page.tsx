import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getActiveSeason } from "@/lib/data";
import { formatDateTime, formatEventDate } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { Alert, Badge, Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { PublishWaiverForm } from "@/components/admin/publish-waiver-form";
import { SAMPLE_WAIVER_TITLE, SAMPLE_WAIVER_BODY } from "@/lib/sample-waiver";

export const metadata: Metadata = { title: "Waivers" };

type Version = {
  id: string;
  version_number: number;
  title: string;
  effective_date: string;
  is_current: boolean;
  body_markdown: string;
  external_waiver_url: string | null;
  created_at: string;
};

async function Waivers() {
  await requireAdmin("/admin/waivers");
  const season = await getActiveSeason();
  if (!season) return <p>Create an active season first.</p>;
  const supabase = await createClient();
  const { data } = await supabase
    .from("waiver_versions")
    .select("id, version_number, title, effective_date, is_current, body_markdown, external_waiver_url, created_at")
    .eq("season_id", season.id)
    .order("version_number", { ascending: false });
  const versions = (data ?? []) as Version[];
  const counts = new Map<string, number>();
  for (const v of versions) {
    const { count } = await supabase
      .from("waiver_signatures")
      .select("id", { count: "exact", head: true })
      .eq("waiver_version_id", v.id);
    counts.set(v.id, count ?? 0);
  }
  const current = versions.find((v) => v.is_current);

  return (
    <div className="space-y-6">
      <Alert tone="info">
        <p className="font-semibold">Have a lawyer review the waiver text. This app records signatures. It doesn&apos;t provide legal advice.</p>
      </Alert>

      <section className="space-y-3" aria-labelledby="versions-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="versions-heading" className="text-2xl font-bold">
            {season.name} versions
          </h2>
          <a href={`/admin/waivers/export?season=${season.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Export signatures (CSV)
          </a>
        </div>
        {versions.length === 0 ? <p>No waiver published yet. Riders can&apos;t register until you publish one.</p> : null}
        <ul className="space-y-2">
          {versions.map((v) => (
            <li key={v.id}>
              <Card className="space-y-1">
                <p className="font-bold">
                  Version {v.version_number}: {v.title} {v.is_current ? <Badge tone="success">Current</Badge> : null}
                </p>
                <p className="text-sm">
                  Effective {formatEventDate(v.effective_date, "short")} · Published {formatDateTime(v.created_at)} ·{" "}
                  {counts.get(v.id) ?? 0} signatures
                </p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="publish-heading">
        <h2 id="publish-heading" className="text-2xl font-bold">
          Publish a new version
        </h2>
        <p>Published versions can&apos;t be edited or deleted. To change the text, publish a new version.</p>
        <PublishWaiverForm
          seasonId={season.id}
          defaults={{
            title: current?.title ?? SAMPLE_WAIVER_TITLE,
            body: current?.body_markdown ?? SAMPLE_WAIVER_BODY,
            externalUrl: current?.external_waiver_url ?? "",
          }}
        />
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Waivers</h1>
      <Suspense fallback={<PageLoading label="Loading waivers" />}>
        <Waivers />
      </Suspense>
    </div>
  );
}
