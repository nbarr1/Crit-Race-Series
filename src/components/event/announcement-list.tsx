import Markdown from "react-markdown";
import { Badge } from "@/components/ui/card";
import { formatDateTime } from "@/lib/time";
import type { Announcement } from "@/lib/types";

/** headingLevel: 2 when the list sits directly under the page h1, 3 under a section h2. */
export function AnnouncementList({ items, headingLevel = 3 }: { items: Announcement[]; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  if (items.length === 0) return <p>No announcements right now.</p>;
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id}>
          <article
            className={`space-y-2 rounded-lg border-2 p-4 ${a.priority === "urgent" ? "border-destructive bg-destructive/5" : "border-border"}`}
            aria-labelledby={`ann-${a.id}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              {a.priority === "urgent" ? <Badge tone="danger">Urgent</Badge> : null}
              <Heading id={`ann-${a.id}`} className="text-lg font-bold">
                {a.title}
              </Heading>
            </div>
            <p className="text-sm text-muted-foreground">Posted {formatDateTime(a.publish_at)}</p>
            {a.body_markdown ? (
              <div className="space-y-2 [&_a]:text-primary [&_a]:underline [&_li]:ml-5 [&_ol]:list-decimal [&_strong]:font-bold [&_ul]:list-disc">
                <Markdown>{a.body_markdown}</Markdown>
              </div>
            ) : null}
          </article>
        </li>
      ))}
    </ul>
  );
}

/** The latest urgent announcement, as a banner. */
export function UrgentBanner({ item }: { item: Announcement }) {
  return (
    <div role="alert" className="rounded-lg border-2 border-destructive bg-destructive/10 p-4">
      <p className="text-lg font-bold">{item.title}</p>
      {item.body_markdown ? (
        <div className="mt-1 [&_a]:underline [&_strong]:font-bold">
          <Markdown>{item.body_markdown}</Markdown>
        </div>
      ) : null}
    </div>
  );
}
