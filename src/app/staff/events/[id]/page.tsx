import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { publicMediaUrl } from "@/lib/data";
import { formatEventDate } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EventNotesForm, UploadForm } from "@/components/staff/event-info-forms";
import { removeMedia } from "./actions";
import type { Media } from "@/lib/types";

export const metadata: Metadata = { title: "Event information" };

type Props = { params: Promise<{ id: string }> };

async function Manage({ params }: Props) {
  const { id } = await params;
  await requireStaff(`/staff/events/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("id, name, event_date, notes, weather_override_text, course_map_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const ev = data as { id: string; name: string; event_date: string; notes: string; weather_override_text: string | null; course_map_id: string | null };
  const { data: media } = await supabase
    .from("media")
    .select("id, type, storage_path, caption, event_id")
    .eq("event_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const files = (media ?? []) as Media[];

  return (
    <div className="space-y-6">
      <p className="text-lg">
        {ev.name}, {formatEventDate(ev.event_date)} ·{" "}
        <Link href={`/events/${ev.id}`} className="font-semibold text-primary underline">
          View the public page
        </Link>
      </p>
      <section aria-labelledby="notes-h" className="space-y-3">
        <h2 id="notes-h" className="text-2xl font-bold">Notes and weather</h2>
        <EventNotesForm eventId={ev.id} override={ev.weather_override_text ?? ""} notes={ev.notes} />
      </section>
      <section aria-labelledby="map-h" className="space-y-3">
        <h2 id="map-h" className="text-2xl font-bold">Course map and GPX</h2>
        {files.length ? (
          <ul className="space-y-2">
            {files.map((f) => (
              <li key={f.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2">
                  <a href={publicMediaUrl(f.storage_path)} className="font-semibold text-primary underline">
                    {f.type === "gpx" ? "GPX" : f.type === "pdf" ? "PDF map" : "Map image"}
                    {f.caption ? `: ${f.caption}` : ""}
                  </a>
                  {f.id === ev.course_map_id ? <span className="text-sm font-semibold">Shown on the event page</span> : null}
                  <form action={removeMedia}>
                    <input type="hidden" name="media_id" value={f.id} />
                    <input type="hidden" name="event_id" value={ev.id} />
                    <Button type="submit" variant="secondary" size="sm">Remove</Button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <p>No files yet.</p>
        )}
        <UploadForm eventId={ev.id} kind="course_map" />
        <UploadForm eventId={ev.id} kind="gpx" />
      </section>
    </div>
  );
}

export default function Page({ params }: Props) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Event information</h1>
      <Suspense fallback={<PageLoading label="Loading" />}>
        <Manage params={params} />
      </Suspense>
    </div>
  );
}
