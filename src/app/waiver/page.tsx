import type { Metadata } from "next";
import { Suspense } from "react";
import { requireRider, safeNextPath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getActiveSeason, getCurrentWaiver } from "@/lib/data";
import { formatDateTime, formatEventDate, todayInDisplayTz } from "@/lib/time";
import { needsGuardian } from "@/lib/validation/waiver";
import { getSettings } from "@/lib/settings";
import { PageLoading } from "@/components/page-loading";
import { Alert } from "@/components/ui/card";
import { WaiverText } from "@/components/waiver/waiver-text";
import { SignForm } from "@/components/waiver/sign-form";

export const metadata: Metadata = { title: "Waiver" };

type Props = { searchParams: Promise<{ next?: string }> };

async function WaiverView({ searchParams }: Props) {
  const next = safeNextPath((await searchParams).next, "/my-races?signed=1");
  const profile = await requireRider("/waiver");
  const season = await getActiveSeason();
  const waiver = season ? await getCurrentWaiver(season.id) : null;
  if (!season || !waiver) {
    return <p>The organizers haven&apos;t published this season&apos;s waiver yet. Check back soon.</p>;
  }
  const { externalWaiverUrl } = await getSettings();
  const externalUrl = waiver.external_waiver_url ?? externalWaiverUrl;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("waiver_signatures")
    .select("id, signed_at, pdf_path")
    .eq("rider_id", profile.id)
    .eq("waiver_version_id", waiver.id)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const signed = existing as { id: string; signed_at: string; pdf_path: string | null } | null;
  let pdfUrl: string | null = null;
  if (signed?.pdf_path) {
    // RLS on storage lets riders read only their own folder.
    const { data } = await supabase.storage.from("waivers").createSignedUrl(signed.pdf_path, 300);
    pdfUrl = data?.signedUrl ?? null;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold">{waiver.title}</h2>
        <p className="text-muted-foreground">
          {season.name} · Version {waiver.version_number} · Effective {formatEventDate(waiver.effective_date, "short")}
        </p>
      </div>
      {signed ? (
        <Alert tone="success">
          <p className="font-semibold">You signed this version on {formatDateTime(signed.signed_at)}.</p>
          {pdfUrl ? (
            <p>
              <a href={pdfUrl} className="font-semibold underline">
                Download your signed copy (PDF)
              </a>
            </p>
          ) : (
            <p>A PDF copy is on its way to your email.</p>
          )}
        </Alert>
      ) : null}
      {externalUrl ? (
        <Alert tone="info">
          This series also uses an external waiver.{" "}
          <a href={externalUrl} className="font-semibold underline" rel="noopener noreferrer" target="_blank">
            Open the external waiver
          </a>
          .
        </Alert>
      ) : null}
      <WaiverText markdown={waiver.body_markdown} />
      {signed ? null : (
        <SignForm
          waiverVersionId={waiver.id}
          riderName={`${profile.first_name} ${profile.last_name}`}
          needsGuardian={needsGuardian(profile.birth_date, todayInDisplayTz())}
          next={next}
        />
      )}
    </div>
  );
}

export default function Page({ searchParams }: Props) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Waiver</h1>
      <Suspense fallback={<PageLoading label="Loading the waiver" />}>
        <WaiverView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
