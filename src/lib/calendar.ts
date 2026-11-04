import "server-only";
import { publicEnv } from "@/lib/env";
import { raceWindow } from "@/lib/data";
import { formatTime } from "@/lib/time";
import type { CalendarEvent } from "@/lib/ics";
import type { EventCategory } from "@/lib/types";

type Ev = {
  id: string;
  name: string;
  event_date: string;
  status: string;
  updated_at?: string;
  venues: { name: string; address: string } | null;
  event_categories: (Pick<EventCategory, "start_at" | "duration_minutes" | "laps"> & { categories: { name: string } })[];
};

/** One calendar entry per event, spanning the first start to the last finish. */
export function toCalendarEvent(e: Ev): CalendarEvent | null {
  const window = raceWindow(e.event_categories);
  if (!window) return null;
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const starts = [...e.event_categories]
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map((c) => `${c.categories.name} ${formatTime(c.start_at)}`)
    .join(", ");
  return {
    uid: `${e.id}@conestee-crit-series`,
    start: new Date(window.start),
    end: new Date(window.end),
    summary: `${e.name}, Conestee Crit Series`,
    location: e.venues ? [e.venues.name, e.venues.address].filter(Boolean).join(", ") : undefined,
    description: `Start times (Eastern): ${starts}. Details, weather, and registration: ${site}/events/${e.id}`,
    url: `${site}/events/${e.id}`,
    canceled: e.status === "canceled",
    updated: e.updated_at ? new Date(e.updated_at) : undefined,
  };
}

export const CALENDAR_SELECT =
  "id, name, event_date, status, updated_at, venues(name, address), event_categories(start_at, duration_minutes, laps, categories(name))";
