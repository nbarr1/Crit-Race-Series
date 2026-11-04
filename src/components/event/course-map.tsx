import { publicMediaUrl } from "@/lib/data";
import type { Media } from "@/lib/types";

export function CourseMap({ map, gpx, eventName }: { map: Media | null; gpx: Media[]; eventName: string }) {
  if (!map && gpx.length === 0) return null;
  const isPdf = map?.storage_path.toLowerCase().endsWith(".pdf");
  return (
    <section aria-labelledby="map-heading" className="space-y-2" id="course-map">
      <h2 id="map-heading" className="text-2xl font-bold">
        Course map
      </h2>
      {map && !isPdf ? (
        <a href={publicMediaUrl(map.storage_path)} className="block">
          {/* Uploaded maps have unknown dimensions; the link opens the full-size image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={publicMediaUrl(map.storage_path)}
            alt={map.caption || `Course map for ${eventName}`}
            className="h-auto w-full rounded-lg border-2 border-border"
            loading="lazy"
            decoding="async"
          />
        </a>
      ) : null}
      {map?.caption && !isPdf ? <p className="text-sm text-muted-foreground">{map.caption}</p> : null}
      <ul className="space-y-1">
        {map && isPdf ? (
          <li>
            <a href={publicMediaUrl(map.storage_path)} className="inline-flex min-h-11 items-center font-semibold text-primary underline">
              Open the course map (PDF)
            </a>
          </li>
        ) : null}
        {gpx.map((g) => (
          <li key={g.id}>
            <a href={publicMediaUrl(g.storage_path)} download className="inline-flex min-h-11 items-center font-semibold text-primary underline">
              Download the course {g.caption ? `(${g.caption}) ` : ""}as GPX
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
