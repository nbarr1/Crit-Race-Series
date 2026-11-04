"use server";

import { redirect } from "next/navigation";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { adminClient, NOT_ADMIN } from "@/lib/admin/server";
import { adminErrorMessage, firstIssue, type AdminState } from "@/lib/admin/errors";
import { formToObject } from "@/lib/validation/profile";
import { easternLocalToUtc, parseDollars } from "@/lib/time";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time.");

const eventSchema = z.object({
  id: z.union([z.literal(""), z.uuid()]).default(""),
  season_id: z.uuid("Choose a season."),
  venue_id: z.uuid("Choose a venue."),
  name: z.string().trim().min(2, "Enter a name.").max(120),
  event_date: isoDate,
  registration_opens_at: localDateTime,
  registration_closes_at: localDateTime,
  status: z.enum(["draft", "published", "canceled", "completed"]),
  notes: z.string().max(5000).default(""),
  categories: z.string().max(50_000).default("[]"),
});

const rowSchema = z.object({
  id: z.union([z.literal(""), z.uuid()]).optional(),
  category_id: z.uuid("Choose a category for each row."),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "Enter a start time for each category."),
  duration_minutes: z.coerce.number().int().min(1, "Enter a length in minutes for each category.").max(600),
  laps: z.union([z.literal(""), z.coerce.number().int().min(1, "Laps must be at least 1.").max(500)]),
  capacity: z.coerce.number().int().min(0, "Capacity can't be negative.").max(1000),
  price: z.string(),
  walk_up_price: z.string(),
});

const LABELS = {
  name: "Name",
  event_date: "Date",
  registration_opens_at: "Registration opens",
  registration_closes_at: "Registration closes",
  season_id: "Season",
  venue_id: "Venue",
  status: "Status",
};

/** Turns the event form into the JSON admin_save_event expects, or an error. */
function buildEvent(form: FormData): { ok: true; event: Record<string, unknown>; id: string } | { ok: false; error: string } {
  const parsed = eventSchema.safeParse(formToObject(form));
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error, LABELS) };
  const v = parsed.data;
  const opens = easternLocalToUtc(v.registration_opens_at);
  const closes = easternLocalToUtc(v.registration_closes_at);
  if (!opens || !closes) return { ok: false, error: "Registration opens and closes: Pick valid dates and times." };
  if (closes <= opens) return { ok: false, error: "Registration has to close after it opens." };

  let raw: unknown;
  try {
    raw = JSON.parse(v.categories);
  } catch {
    return { ok: false, error: "The categories couldn't be read. Reload the page and try again." };
  }
  const rows = z.array(rowSchema).max(20).safeParse(raw);
  if (!rows.success) return { ok: false, error: rows.error.issues[0]?.message ?? "Check the categories." };
  const seen = new Set<string>();
  const categories = [];
  for (const r of rows.data) {
    if (seen.has(r.category_id)) return { ok: false, error: "Each category can appear only once in an event." };
    seen.add(r.category_id);
    const price = parseDollars(r.price);
    const walkUp = parseDollars(r.walk_up_price);
    if (price === null || walkUp === null) return { ok: false, error: "Enter each price in dollars, such as 25 or 25.50. Use 0 for free." };
    const startAt = easternLocalToUtc(`${v.event_date}T${r.start_time}`);
    if (!startAt) return { ok: false, error: "Enter a valid start time for each category." };
    categories.push({
      id: r.id || null,
      category_id: r.category_id,
      start_at: startAt,
      duration_minutes: r.duration_minutes,
      laps: r.laps === "" ? null : r.laps,
      capacity: r.capacity,
      price_cents: price,
      walk_up_price_cents: walkUp,
    });
  }
  if (v.status === "published" && categories.length === 0) {
    return { ok: false, error: "Add at least one category before publishing the event." };
  }
  return {
    ok: true,
    id: v.id,
    event: {
      id: v.id || null,
      season_id: v.season_id,
      venue_id: v.venue_id,
      name: v.name,
      event_date: v.event_date,
      registration_opens_at: opens,
      registration_closes_at: closes,
      status: v.status,
      notes: v.notes,
      categories,
    },
  };
}

function invalidateEvents(eventId?: string) {
  updateTag("events");
  updateTag("registrations");
  if (eventId) updateTag(`event:${eventId}`);
  revalidatePath("/admin/events");
}

export async function saveEvent(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await adminClient();
  if (!admin) return NOT_ADMIN;
  const built = buildEvent(form);
  if (!built.ok) return { error: built.error };
  const { data, error } = await admin.supabase.rpc("admin_save_event", { p_event: built.event });
  if (error) {
    console.error("admin_save_event failed", error.message);
    return { error: adminErrorMessage(error.message) };
  }
  const id = data as string;
  invalidateEvents(id);
  if (!built.id) redirect(`/admin/events/${id}?created=1`);
  revalidatePath(`/admin/events/${id}`);
  return { message: "Saved the event.", savedId: id };
}

const copySchema = z.object({
  source_id: z.uuid(),
  name: z.string().trim().min(2, "Enter a name for the copy.").max(120),
  event_date: isoDate,
});

export async function copyEvent(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await adminClient();
  if (!admin) return NOT_ADMIN;
  const parsed = copySchema.safeParse(formToObject(form));
  if (!parsed.success) return { error: firstIssue(parsed.error, { name: "Name", event_date: "Date" }) };
  const { data, error } = await admin.supabase.rpc("admin_copy_event", {
    p_source_id: parsed.data.source_id,
    p_name: parsed.data.name,
    p_event_date: parsed.data.event_date,
  });
  if (error) return { error: adminErrorMessage(error.message) };
  invalidateEvents();
  redirect(`/admin/events/${data as string}?copied=1`);
}

export async function deleteEvent(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await adminClient();
  if (!admin) return NOT_ADMIN;
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "That event wasn't found." };
  if (form.get("confirm") !== "on") return { error: "Check the box to confirm." };
  const { error } = await admin.supabase.rpc("admin_delete_event", { p_id: id.data });
  if (error) return { error: adminErrorMessage(error.message) };
  invalidateEvents(id.data);
  redirect(`/admin/events?season=${encodeURIComponent(String(form.get("season_id") ?? ""))}`);
}
