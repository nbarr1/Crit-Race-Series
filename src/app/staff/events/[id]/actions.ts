"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { checkUpload } from "@/lib/uploads";

export type EventInfoState = { error?: string; message?: string };

async function staff() {
  const p = await getCurrentProfile();
  return p?.role === "staff" || p?.role === "admin" ? createClient() : null;
}

const id = z.uuid();

export async function saveEventNotes(_prev: EventInfoState, form: FormData): Promise<EventInfoState> {
  const supabase = await staff();
  const eventId = id.safeParse(form.get("event_id"));
  if (!supabase || !eventId.success) return { error: "Only race staff can change this." };
  const override = String(form.get("weather_override_text") ?? "").trim().slice(0, 500);
  const notes = String(form.get("notes") ?? "").trim().slice(0, 4000);
  const { error } = await supabase
    .from("events")
    .update({ weather_override_text: override || null, notes })
    .eq("id", eventId.data);
  if (error) return { error: "That didn't save. Try again." };
  updateTag(`event:${eventId.data}`);
  updateTag("events");
  return { message: "Saved." };
}

export async function uploadCourseFile(_prev: EventInfoState, form: FormData): Promise<EventInfoState> {
  const supabase = await staff();
  const eventId = id.safeParse(form.get("event_id"));
  if (!supabase || !eventId.success) return { error: "Only race staff can upload files." };
  const kind = form.get("kind") === "gpx" ? "gpx" : "course_map";
  const file = form.get("file");
  const checked = checkUpload(file instanceof File ? file : null, kind, `events/${eventId.data}`);
  if (!checked.ok) return { error: checked.error };

  const upload = await supabase.storage
    .from("public-media")
    .upload(checked.path, file as File, { contentType: checked.contentType, upsert: false });
  if (upload.error) {
    console.error("upload failed", upload.error.message);
    return { error: "The upload failed. Try again." };
  }
  const caption = String(form.get("caption") ?? "").trim().slice(0, 200);
  const { data: media, error } = await supabase
    .from("media")
    .insert({ type: kind === "gpx" ? "gpx" : checked.path.endsWith(".pdf") ? "pdf" : "course_map", storage_path: checked.path, caption, event_id: eventId.data })
    .select("id")
    .single();
  if (error) return { error: "The file uploaded, but it couldn't be attached. Try again." };
  if (kind === "course_map") {
    const { error: linkError } = await supabase.from("events").update({ course_map_id: (media as { id: string }).id }).eq("id", eventId.data);
    if (linkError) return { error: "The map uploaded, but it couldn't be set on the event." };
  }
  updateTag(`event:${eventId.data}`);
  return { message: kind === "gpx" ? "GPX file added." : "Course map updated." };
}

export async function removeMedia(form: FormData): Promise<void> {
  const supabase = await staff();
  const mediaId = id.safeParse(form.get("media_id"));
  const eventId = id.safeParse(form.get("event_id"));
  if (!supabase || !mediaId.success || !eventId.success) return;
  await supabase.from("events").update({ course_map_id: null }).eq("id", eventId.data).eq("course_map_id", mediaId.data);
  await supabase.from("media").update({ deleted_at: new Date().toISOString() }).eq("id", mediaId.data);
  updateTag(`event:${eventId.data}`);
}
