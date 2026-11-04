"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { emailAnnouncement } from "@/lib/announcement-service";
import { fieldErrors, formToObject } from "@/lib/validation/profile";

export type AnnouncementState = { errors?: Record<string, string>; message?: string };

// <input type="datetime-local"> sends local Eastern time without an offset; the
// form also sends the browser's offset so the server can store UTC.
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

const schema = z
  .object({
    title: z.string().trim().min(3, "Enter a title.").max(140),
    body_markdown: z.string().trim().max(10_000).default(""),
    event_id: z.union([z.literal(""), z.uuid()]).default(""),
    priority: z.enum(["normal", "urgent"]),
    publish_at: z.union([z.literal(""), localDateTime]).default(""),
    expires_at: z.union([z.literal(""), localDateTime]).default(""),
    tz_offset_minutes: z.coerce.number().int().min(-900).max(900).default(0),
    email: z.enum(["none", "event_registrants", "season"]),
  })
  .refine((v) => v.email !== "event_registrants" || v.event_id !== "", {
    path: ["email"],
    message: "Pick an event to email its registered riders.",
  });

function toUtc(local: string, offsetMinutes: number): string | null {
  if (!local) return null;
  // getTimezoneOffset() is minutes behind UTC (240 for EDT).
  const ms = Date.parse(`${local}:00Z`) + offsetMinutes * 60_000;
  return new Date(ms).toISOString();
}

async function staffClient() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "staff" && profile?.role !== "admin") return null;
  return { profile, supabase: await createClient() };
}

export async function createAnnouncement(_prev: AnnouncementState, form: FormData): Promise<AnnouncementState> {
  const ctx = await staffClient();
  if (!ctx) return { errors: { form: "Only race staff can post announcements." } };
  const parsed = schema.safeParse(formToObject(form));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const publishAt = toUtc(v.publish_at, v.tz_offset_minutes) ?? new Date().toISOString();
  const expiresAt = toUtc(v.expires_at, v.tz_offset_minutes);
  if (expiresAt && expiresAt <= publishAt) return { errors: { expires_at: "The end time must be after the publish time." } };

  const { data, error } = await ctx.supabase
    .from("announcements")
    .insert({
      title: v.title,
      body_markdown: v.body_markdown,
      event_id: v.event_id || null,
      priority: v.priority,
      publish_at: publishAt,
      expires_at: expiresAt,
      send_email: v.email !== "none",
      email_audience: v.email === "none" ? null : v.email,
      created_by: ctx.profile.id,
    })
    .select("id")
    .single();
  if (error) {
    console.error("create announcement failed", error.message);
    return { errors: { form: "The announcement didn't save. Try again." } };
  }
  updateTag("announcements");

  let message = publishAt <= new Date().toISOString() ? "Posted." : "Scheduled.";
  if (v.email !== "none") {
    try {
      const sent = await emailAnnouncement(ctx.supabase, (data as { id: string }).id);
      message += sent === null ? " The email goes out at the publish time." : ` Emailed ${sent} ${sent === 1 ? "rider" : "riders"}.`;
    } catch (err) {
      console.error("announcement email failed", err instanceof Error ? err.message : err);
      message += " The email didn't send yet. The scheduled job retries it.";
    }
  }
  return { message };
}

export async function removeAnnouncement(form: FormData): Promise<void> {
  const ctx = await staffClient();
  const id = z.uuid().safeParse(form.get("id"));
  if (!ctx || !id.success) return;
  await ctx.supabase.from("announcements").update({ deleted_at: new Date().toISOString() }).eq("id", id.data);
  updateTag("announcements");
}
