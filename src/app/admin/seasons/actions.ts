"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { adminClient, NOT_ADMIN } from "@/lib/admin/server";
import { adminErrorMessage, firstIssue, type AdminState } from "@/lib/admin/errors";
import { formToObject } from "@/lib/validation/profile";
import { parseDollars } from "@/lib/time";

const schema = z.object({
  id: z.union([z.literal(""), z.uuid()]).default(""),
  name: z.string().trim().min(2, "Enter a name.").max(120),
  year: z.coerce.number({ error: "Enter a year." }).int().min(2000, "Enter a year from 2000.").max(2100),
  season_pass_price: z.string().trim().max(12).default(""),
  points_rules_id: z.union([z.literal(""), z.uuid()]).default(""),
});
const LABELS = { name: "Name", year: "Year", season_pass_price: "Season pass price" };

export async function saveSeason(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await adminClient();
  if (!admin) return NOT_ADMIN;
  const parsed = schema.safeParse(formToObject(form));
  if (!parsed.success) return { error: firstIssue(parsed.error, LABELS) };
  const v = parsed.data;
  let passCents: number | null = null;
  if (v.season_pass_price) {
    passCents = parseDollars(v.season_pass_price);
    if (passCents === null) return { error: "Season pass price: Enter an amount in dollars, such as 200, or leave it blank." };
  }
  const { data, error } = await admin.supabase.rpc("admin_save_season", {
    p_id: v.id || null,
    p_name: v.name,
    p_year: v.year,
    p_season_pass_price_cents: passCents,
    p_points_rules_id: v.points_rules_id || null,
  });
  if (error) return { error: adminErrorMessage(error.message) };
  updateTag("seasons");
  revalidatePath("/admin/seasons");
  return { message: v.id ? `Saved ${v.name}.` : `Created ${v.name}. Add its events, then make it the active season.`, savedId: data as string };
}

export async function activateSeason(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await adminClient();
  if (!admin) return NOT_ADMIN;
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "That season wasn't found." };
  const { error } = await admin.supabase.rpc("admin_activate_season", { p_id: id.data });
  if (error) return { error: adminErrorMessage(error.message) };
  // The active season drives the schedule, registration, standings, and waivers.
  for (const tag of ["seasons", "events", "registrations", "results", "waivers"]) updateTag(tag);
  revalidatePath("/admin", "layout");
  return { message: "That season is now active. The schedule, registration, and standings show it." };
}
