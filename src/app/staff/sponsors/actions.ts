"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { checkUpload } from "@/lib/uploads";
import { fieldErrors, formToObject } from "@/lib/validation/profile";

export type SponsorState = { errors?: Record<string, string>; message?: string };

const schema = z.object({
  name: z.string().trim().min(2, "Enter the sponsor's name.").max(120),
  url: z.union([z.literal(""), z.string().trim().max(500).refine((v) => /^https:\/\/[^\s]+$/.test(v), "Use a full https:// link.")]).default(""),
  tier: z.enum(["presenting", "gold", "silver", "supporter"]),
  sort_order: z.coerce.number().int().min(0).max(999).default(100),
});

async function staff() {
  const p = await getCurrentProfile();
  return p?.role === "staff" || p?.role === "admin" ? createClient() : null;
}

export async function addSponsor(_prev: SponsorState, form: FormData): Promise<SponsorState> {
  const supabase = await staff();
  if (!supabase) return { errors: { form: "Only race staff can add sponsors." } };
  const parsed = schema.safeParse(formToObject(form));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  let logoPath: string | null = null;
  const file = form.get("logo");
  if (file instanceof File && file.size > 0) {
    const checked = checkUpload(file, "logo", "sponsors");
    if (!checked.ok) return { errors: { logo: checked.error } };
    const up = await supabase.storage.from("public-media").upload(checked.path, file, { contentType: checked.contentType });
    if (up.error) return { errors: { logo: "The logo upload failed. Try again." } };
    logoPath = checked.path;
  }
  const { error } = await supabase.from("sponsors").insert({ ...parsed.data, url: parsed.data.url || null, logo_path: logoPath, is_active: true });
  if (error) return { errors: { form: "The sponsor didn't save. Try again." } };
  updateTag("sponsors");
  return { message: `Added ${parsed.data.name}.` };
}

export async function setSponsorActive(form: FormData): Promise<void> {
  const supabase = await staff();
  const id = z.uuid().safeParse(form.get("id"));
  if (!supabase || !id.success) return;
  await supabase.from("sponsors").update({ is_active: form.get("active") === "true" }).eq("id", id.data);
  updateTag("sponsors");
}
