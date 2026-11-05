import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import Link from "next/link";
import { connection } from "next/server";
import { eventPhase, getSchedule } from "@/lib/data";
import { formatEventDate, formatTime, todayInDisplayTz } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { EventStatusBadge } from "@/components/event-status-badge";
import { SetupNotice } from "@/components/setup-notice";

export const metadata: Metadata = { title: "Schedule" };

async function ScheduleList() {
  await connection();
  const events = await getSchedule();
  const today = todayInDisplayTz();

  return (
    <>
      {events === null ? (
        <SetupNotice />
      ) : events.length === 0 ? (
        <p>The schedule hasn&apos;t been posted yet.</p>
      ) : (
        <ol className="space-y-3">
          {events.map((e) => {
            const phase = eventPhase(e, today);
            const firstStart = e.event_categories.map((c) => c.start_at).sort()[0];
            return (
              <li key={e.id}>
                <Card className="relative flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="text-xl font-bold">
                      <Link href={`/events/${e.id}`} className="underline after:absolute after:inset-0 after:rounded-lg after:content-['']">
                        {e.name}
                      </Link>
                    </h2>
                    <p>
                      {formatEventDate(e.event_date)}
                      {firstStart ? ` · First race ${formatTime(firstStart)}` : null}
                    </p>
                    {e.venues ? <p className="text-muted-foreground">{e.venues.name}</p> : null}
                  </div>
                  <EventStatusBadge phase={phase} />
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Schedule</h1>
      <p>
        <a href="/schedule/calendar.ics" className="inline-flex min-h-11 items-center font-semibold text-primary underline">
          Add the whole season to your calendar (.ics)
        </a>
      </p>
      <Suspense fallback={<PageLoading label="Loading the schedule" />}>
        <ScheduleList />
      </Suspense>
    </div>
  );
}
