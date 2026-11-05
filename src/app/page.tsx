import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { eventPhase, getAnnouncements, getSchedule, getSponsors } from "@/lib/data";
import { formatEventDate, formatTime, todayInDisplayTz } from "@/lib/time";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SetupNotice } from "@/components/setup-notice";
import { PageLoading } from "@/components/page-loading";
import { Countdown } from "@/components/event/countdown";
import { UrgentBanner } from "@/components/event/announcement-list";
import { SponsorStrip } from "@/components/event/sponsor-strip";
import { SERIES_NAME } from "@/lib/site";

async function UrgentAnnouncement() {
  const urgent = (await getAnnouncements({ limit: 10 })).find((a) => a.priority === "urgent");
  return urgent ? <UrgentBanner item={urgent} /> : null;
}

async function NextRace() {
  await connection();
  const events = await getSchedule();
  if (events === null) return <SetupNotice />;
  const today = todayInDisplayTz();
  const next = events.find((e) => {
    const phase = eventPhase(e, today);
    return phase === "upcoming" || phase === "today";
  });
  if (!next) return <p>No upcoming races are posted. Check the schedule for past events.</p>;
  const firstStart = next.event_categories.map((c) => c.start_at).sort()[0];

  return (
    <Card className="space-y-3">
      <h2 className="text-2xl font-bold">Next race: {next.name}</h2>
      <p className="text-lg">
        {formatEventDate(next.event_date)}
        {firstStart ? ` · First race ${formatTime(firstStart)}` : null}
      </p>
      {firstStart ? <Countdown startAt={firstStart} /> : null}
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <Link href={`/register?event=${next.id}`} className={buttonVariants({ size: "lg" })}>
          Register
        </Link>
        <Link href={`/events/${next.id}`} className={buttonVariants({ variant: "secondary", size: "lg" })}>
          Race details
        </Link>
        <Link href={`/events/${next.id}#course-map`} className={buttonVariants({ variant: "secondary", size: "lg" })}>
          Course map
        </Link>
        <Link href={`/events/${next.id}#weather-heading`} className={buttonVariants({ variant: "secondary", size: "lg" })}>
          Weather
        </Link>
      </div>
    </Card>
  );
}

async function Sponsors() {
  return <SponsorStrip sponsors={await getSponsors()} />;
}

export default function HomePage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <UrgentAnnouncement />
      </Suspense>
      <section className="space-y-2">
        <h1 className="text-3xl font-bold">{SERIES_NAME}</h1>
        <p className="text-lg">Criterium racing at Conestee Nature Park. Four fields: A, B, Open Women, and Masters.</p>
      </section>
      {/* The fallback holds the card's space, so the links below don't jump when it streams in. */}
      <Suspense fallback={<div className="min-h-72"><PageLoading label="Loading the next race" /></div>}>
        <NextRace />
      </Suspense>
      <nav aria-label="Series" className="flex flex-wrap gap-x-4 font-semibold">
        <Link href="/schedule" className="inline-flex min-h-11 items-center text-primary underline">Full schedule</Link>
        <Link href="/announcements" className="inline-flex min-h-11 items-center text-primary underline">Announcements</Link>
        <Link href="/sponsors" className="inline-flex min-h-11 items-center text-primary underline">Sponsors</Link>
      </nav>
      <Suspense fallback={null}>
        <Sponsors />
      </Suspense>
    </div>
  );
}
