import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatEventDate, nowMs } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AnnouncementForm } from "@/components/staff/announcement-form";
import { removeAnnouncement } from "./actions";
import type { Announcement } from "@/lib/types";

export const metadata: Metadata = { title: "Manage announcements" };

async function Manage() {
  await requireStaff("/staff/announcements");
  const supabase = await createClient();
  const [{ data: anns }, { data: season }] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, title, body_markdown, event_id, priority, publish_at, expires_at, send_email, email_audience, emailed_at, email_recipient_count")
      .is("deleted_at", null)
      .order("publish_at", { ascending: false })
      .limit(50),
    supabase.from("seasons").select("id").eq("is_active", true).maybeSingle(),
  ]);
  const { data: events } = season
    ? await supabase.from("events").select("id, name, event_date").eq("season_id", (season as { id: string }).id).is("deleted_at", null).order("event_date")
    : { data: [] };
  const evs = ((events ?? []) as { id: string; name: string; event_date: string }[]).map((e) => ({
    id: e.id,
    label: `${e.name}, ${formatEventDate(e.event_date, "short")}`,
  }));
  const now = nowMs();

  return (
    <div className="space-y-6">
      <section aria-labelledby="new-ann" className="space-y-3">
        <h2 id="new-ann" className="text-2xl font-bold">
          New announcement
        </h2>
        <AnnouncementForm events={evs} />
      </section>
      <section aria-labelledby="list-ann" className="space-y-3">
        <h2 id="list-ann" className="text-2xl font-bold">
          Recent announcements
        </h2>
        <ul className="space-y-2">
          {((anns ?? []) as Announcement[]).map((a) => {
            const live = new Date(a.publish_at).getTime() <= now && (!a.expires_at || new Date(a.expires_at).getTime() > now);
            return (
              <li key={a.id}>
                <Card className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold">{a.title}</p>
                    {a.priority === "urgent" ? <Badge tone="danger">Urgent</Badge> : null}
                    <Badge tone={live ? "success" : "neutral"}>{live ? "Showing" : new Date(a.publish_at).getTime() > now ? "Scheduled" : "Ended"}</Badge>
                  </div>
                  <p className="text-sm">
                    Publish {formatDateTime(a.publish_at)}
                    {a.expires_at ? ` · Ends ${formatDateTime(a.expires_at)}` : ""}
                    {a.event_id ? ` · ${evs.find((e) => e.id === a.event_id)?.label ?? "Event"}` : " · Whole series"}
                  </p>
                  {a.send_email ? (
                    <p className="text-sm">
                      Email to {a.email_audience === "season" ? "the season list" : "event riders"}:{" "}
                      {a.emailed_at ? `sent ${formatDateTime(a.emailed_at)}${a.email_recipient_count !== null ? ` to ${a.email_recipient_count}` : ""}` : "waiting"}
                    </p>
                  ) : null}
                  <form action={removeAnnouncement}>
                    <input type="hidden" name="id" value={a.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      Remove
                    </Button>
                  </form>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Announcements</h1>
      <Suspense fallback={<PageLoading label="Loading" />}>
        <Manage />
      </Suspense>
    </div>
  );
}
