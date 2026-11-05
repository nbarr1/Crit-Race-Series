import Link from "next/link";
import { publicMediaUrl } from "@/lib/data";
import type { Sponsor } from "@/lib/types";

/** Sponsor logos (or names, until a logo is uploaded), each linking to the sponsor. */
export function SponsorLogo({ sponsor, size = "md" }: { sponsor: Sponsor; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-20 w-48" : "h-14 w-36";
  // Name tiles grow taller for long names so the text keeps its padding.
  const tile = size === "lg" ? "min-h-20 w-48" : "min-h-14 w-36";
  const content = sponsor.logo_path ? (
    // Logos come from the public storage bucket at unknown sizes; object-contain keeps them inside the box.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={publicMediaUrl(sponsor.logo_path)} alt={sponsor.name} className={`${box} object-contain`} loading="lazy" decoding="async" />
  ) : (
    <span className={`flex ${tile} items-center justify-center rounded border-2 border-border px-3 py-2 text-center text-sm leading-tight font-bold`}>{sponsor.name}</span>
  );
  return sponsor.url ? (
    <a href={sponsor.url} rel="noopener noreferrer sponsored" className="inline-flex min-h-11 items-center" aria-label={sponsor.logo_path ? undefined : `${sponsor.name} (sponsor website)`}>
      {content}
    </a>
  ) : (
    content
  );
}

export function SponsorStrip({ sponsors }: { sponsors: Sponsor[] }) {
  if (sponsors.length === 0) return null;
  return (
    <section aria-labelledby="sponsors-strip-heading" className="space-y-2">
      <h2 id="sponsors-strip-heading" className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
        Thanks to our sponsors
      </h2>
      <ul className="flex flex-wrap items-center gap-4">
        {sponsors.map((s) => (
          <li key={s.id}>
            <SponsorLogo sponsor={s} />
          </li>
        ))}
      </ul>
      <Link href="/sponsors" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline">
        All sponsors
      </Link>
    </section>
  );
}
