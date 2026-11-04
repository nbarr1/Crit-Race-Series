import type { Metadata } from "next";
import { Suspense } from "react";
import { getSponsors, SPONSOR_TIERS } from "@/lib/data";
import { SponsorLogo } from "@/components/event/sponsor-strip";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Sponsors" };

async function SponsorTiers() {
  const sponsors = await getSponsors();
  if (sponsors.length === 0) return <p>Sponsors will be listed here.</p>;
  const known = new Set(SPONSOR_TIERS.map((t) => t.key));
  const tiers = [...SPONSOR_TIERS, ...[...new Set(sponsors.map((s) => s.tier))].filter((t) => !known.has(t)).map((t) => ({ key: t, label: t }))];
  return (
    <div className="space-y-6">
      {tiers.map((tier) => {
        const list = sponsors.filter((s) => s.tier === tier.key);
        if (list.length === 0) return null;
        return (
          <section key={tier.key} aria-labelledby={`tier-${tier.key}`} className="space-y-3">
            <h2 id={`tier-${tier.key}`} className="text-2xl font-bold">
              {tier.label}
            </h2>
            <ul className="flex flex-wrap items-center gap-6">
              {list.map((s) => (
                <li key={s.id}>
                  <SponsorLogo sponsor={s} size={tier.key === "presenting" ? "lg" : "md"} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Sponsors</h1>
      <p>These businesses make the series possible. Thank them with your business.</p>
      <Suspense fallback={<PageLoading label="Loading sponsors" />}>
        <SponsorTiers />
      </Suspense>
    </div>
  );
}
