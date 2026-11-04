import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { eventPhase, getAnnouncements, getEvent, raceWindow } from "@/lib/data";
import { formatCents, formatDateTime, formatEventDate, formatTime, nowMs, todayInDisplayTz } from "@/lib/time";
import { Alert, Card } from "@/components/ui/card";
import { EventStatusBadge } from "@/components/event-status-badge";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { WeatherPanel } from "@/components/event/weather-panel";
import { CourseMap } from "@/components/event/course-map";
import { AnnouncementList } from "@/components/event/announcement-list";
import { EventResults } from "@/components/event/event-results";
import { getEventResults } from "@/lib/results-data";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await getEvent((await params).id);
  return { title: event?.name ?? "Event" };
}

async function EventDetailView({ params }: Props) {
  const event = await getEvent((await params).id);
  if (!event) notFound();
  await connection();
  const phase = eventPhase(event, todayInDisplayTz());
  const now = nowMs();
  const registrationOpen =
    event.status === "published" &&
    now >= new Date(event.registration_opens_at).getTime() &&
    now < new Date(event.registration_closes_at).getTime();
  const venue = event.venues;
  const directions = venue
    ? `https://www.google.com/maps/dir/?api=1&destination=${venue.latitude},${venue.longitude}`
    : null;
  const window = raceWindow(event.event_categories);
  const [announcements, results] = await Promise.all([
    getAnnouncements({ eventId: event.id, limit: 10 }),
    getEventResults(event.id),
  ]);

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold">{event.name}</h1>
          <EventStatusBadge phase={phase} />
        </div>
        <p className="text-lg">{formatEventDate(event.event_date)}</p>
        {phase === "canceled" ? (
          <Alert tone="error">This event is canceled.</Alert>
        ) : null}
        <p className="text-muted-foreground">
          Online registration closes {formatDateTime(event.registration_closes_at)}. After that, register at the desk on
          race day.
        </p>
        {phase === "upcoming" || phase === "today" ? (
          registrationOpen ? (
            <Link href={`/register?event=${event.id}`} className={buttonVariants({ size: "lg" })}>
              Register for {event.name}
            </Link>
          ) : now < new Date(event.registration_opens_at).getTime() ? (
            <p className="font-semibold">Online registration opens {formatDateTime(event.registration_opens_at)}.</p>
          ) : null
        ) : null}
        <nav aria-label="On this page" className="flex flex-wrap gap-x-4 text-base font-semibold">
          {results.length ? (
            <a href="#results-heading" className="inline-flex min-h-11 items-center text-primary underline">Results</a>
          ) : null}
          <a href="#weather-heading" className="inline-flex min-h-11 items-center text-primary underline">Weather</a>
          {event.course_map || event.gpx.length ? (
            <a href="#course-map" className="inline-flex min-h-11 items-center text-primary underline">Course map</a>
          ) : null}
          <a href="#venue-heading" className="inline-flex min-h-11 items-center text-primary underline">Directions</a>
          <a href={`/events/${event.id}/calendar.ics`} className="inline-flex min-h-11 items-center text-primary underline">Add to calendar</a>
        </nav>
      </header>

      {announcements.length ? (
        <section aria-labelledby="event-ann-heading" className="space-y-2">
          <h2 id="event-ann-heading" className="text-2xl font-bold">
            Announcements
          </h2>
          <AnnouncementList items={announcements} />
        </section>
      ) : null}

      <EventResults categories={results} />

      <section aria-labelledby="categories-heading" className="space-y-3">
        <h2 id="categories-heading" className="text-2xl font-bold">
          Races
        </h2>
        <ul className="space-y-3">
          {event.event_categories.map((ec) => {
            const a = event.availability[ec.id];
            return (
              <li key={ec.id}>
                <Card className="space-y-1">
                  <h3 className="text-xl font-bold">{ec.categories.name}</h3>
                  <p>
                    Starts {formatTime(ec.start_at)} · {ec.duration_minutes} minutes
                    {ec.laps ? ` plus ${ec.laps} ${ec.laps === 1 ? "lap" : "laps"}` : null}
                  </p>
                  <p>
                    {formatCents(ec.price_cents)} online · {formatCents(ec.walk_up_price_cents)} walk-up
                  </p>
                  {a ? (
                    <p className="font-semibold">
                      {a.spots_left > 0 ? `${a.spots_left} of ${a.capacity} spots left` : "Full. New registrations join the waitlist."}
                    </p>
                  ) : null}
                  {ec.categories.eligibility_notes ? (
                    <p className="text-sm text-muted-foreground">{ec.categories.eligibility_notes}</p>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      {venue ? (
        <section aria-labelledby="venue-heading" className="space-y-2">
          <h2 id="venue-heading" className="text-2xl font-bold">
            Location
          </h2>
          <p className="font-semibold">{venue.name}</p>
          <p>{venue.address}</p>
          {!venue.coordinates_confirmed ? (
            <p className="text-sm text-muted-foreground">The organizers are still confirming the exact location.</p>
          ) : null}
          {venue.parking_notes ? <p>{venue.parking_notes}</p> : null}
          {directions ? (
            <a href={directions} className="inline-flex min-h-11 items-center font-semibold text-primary underline">
              Get directions to {venue.name}
            </a>
          ) : null}
        </section>
      ) : null}

      {venue && window ? (
        <Suspense fallback={<PageLoading label="Loading the forecast" />}>
          <WeatherPanel
            lat={venue.latitude}
            lon={venue.longitude}
            eventDate={event.event_date}
            windowStart={window.start}
            windowEnd={window.end}
            overrideText={event.weather_override_text}
            canceled={event.status === "canceled"}
          />
        </Suspense>
      ) : null}

      <CourseMap map={event.course_map} gpx={event.gpx} eventName={event.name} />

      {event.notes ? (
        <section aria-labelledby="notes-heading" className="space-y-2">
          <h2 id="notes-heading" className="text-2xl font-bold">
            Notes
          </h2>
          <p className="whitespace-pre-line">{event.notes}</p>
        </section>
      ) : null}
    </article>
  );
}

export default function Page({ params }: Props) {
  return (
    <Suspense fallback={<PageLoading label="Loading the event" />}>
      <EventDetailView params={params} />
    </Suspense>
  );
}
