"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { adminClient, NOT_ADMIN } from "@/lib/admin/server";
import { adminErrorMessage, firstIssue, type AdminState } from "@/lib/admin/errors";
import { formToObject } from "@/lib/validation/profile";

const coord = (min: number, max: number, msg: string) => z.coerce.number({ error: msg }).min(min, msg).max(max, msg);
const schema = z.object({
  id: z.union([z.literal(""), z.uuid()]).default(""),
  name: z.string().trim().min(2, "Enter a name.").max(120),
  address: z.string().trim().max(300).default(""),
  latitude: coord(-90, 90, "Enter a latitude from -90 to 90, such as 35.2338."),
  longitude: coord(-180, 180, "Enter a longitude from -180 to 180, such as -82.7343."),
  coordinates_confirmed: z.literal("on").optional(),
  parking_notes: z.string().trim().max(2000).default(""),
  map_embed_url: z.union([z.literal(""), z.string().trim().max(500).regex(/^https:\/\/\S+$/, "Use a full https:// link.")]).default(""),
});
const LABELS = { name: "Name", address: "Address", latitude: "Latitude", longitude: "Longitude", map_embed_url: "Map link" };

export async function saveVenue(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await adminClient();
  if (!admin) return NOT_ADMIN;
  const parsed = schema.safeParse(formToObject(form));
  if (!parsed.success) return { error: firstIssue(parsed.error, LABELS) };
  const v = parsed.data;
  const { error } = await admin.supabase.rpc("admin_save_venue", {
    p_id: v.id || null,
    p_name: v.name,
    p_address: v.address,
    p_latitude: v.latitude,
    p_longitude: v.longitude,
    p_coordinates_confirmed: v.coordinates_confirmed === "on",
    p_parking_notes: v.parking_notes,
    p_map_embed_url: v.map_embed_url || null,
  });
  if (error) return { error: adminErrorMessage(error.message) };
  // Venue details show on every event page and drive the weather forecast.
  updateTag("events");
  updateTag("weather");
  revalidatePath("/admin/venues");
  return { message: `Saved ${v.name}.` };
}
