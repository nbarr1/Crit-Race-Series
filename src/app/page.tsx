import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { connection } from "next/server";
import { eventPhase, getSchedule } from "@/lib/data";
import { formatEventDate, formatTime, todayInDisplayTz } from "@/lib/time";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SetupNotice } from "@/components/setup-notice";
import { SERIES_NAME } from "@/lib/site";

async function NextRace() {
  await connection();
  const events = await getSchedule();
  const today = todayInDisplayTz();
  const next = events?.find((e) => {
    const phase = eventPhase(e, today);
    return phase === "upcoming" || phase === "today";
  });
  const firstStart = next?.event_categories.map((c) => c.start_at).sort()[0];

  return (
    <>
      {events === null ? <SetupNotice /> : null}

      {next ? (
        <Card className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Next race</h2>
          <p className="text-2xl font-bold">{next.name}</p>
          <p className="text-lg">
            {formatEventDate(next.event_date)}
            {firstStart ? ` · First race ${formatTime(firstStart)}` : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/events/${next.id}`} className={buttonVariants({ size: "lg" })}>
              Race details
            </Link>
            <Link href="/schedule" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              Full schedule
            </Link>
          </div>
        </Card>
      ) : events ? (
        <p>No upcoming races are posted. Check the schedule for past events.</p>
      ) : null}
    </>
  );
}

export default function Page() {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-3xl font-bold">{SERIES_NAME}</h1>
        <p className="text-lg">Criterium racing at Connestee Nature Park. Four fields: A, B, Open Women, and Masters.</p>
      </section>
      <Suspense fallback={<PageLoading label="Loading the next race" />}>
        <NextRace />
      </Suspense>
    </div>
  );
}
