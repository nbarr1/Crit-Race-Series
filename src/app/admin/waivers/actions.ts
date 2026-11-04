"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, formToObject } from "@/lib/validation/profile";

export type PublishState = { errors?: Record<string, string>; published?: number };

const schema = z.object({
  season_id: z.uuid(),
  title: z.string().trim().min(3, "Enter a title.").max(200),
  body_markdown: z.string().trim().min(50, "The waiver text looks too short.").max(50_000),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an effective date."),
  external_waiver_url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https:\/\//.test(v), "Use a full https:// link, or leave it blank.")
    .optional()
    .default(""),
  confirm: z.literal("on", { error: "Confirm that riders will need to sign again." }),
});

export async function publishWaiver(_prev: PublishState, form: FormData): Promise<PublishState> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return { errors: { form: "Only admins can publish waivers." } };
  const parsed = schema.safeParse(formToObject(form));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_waiver_version", {
    p_season_id: parsed.data.season_id,
    p_title: parsed.data.title,
    p_body_markdown: parsed.data.body_markdown,
    p_effective_date: parsed.data.effective_date,
    p_external_waiver_url: parsed.data.external_waiver_url || null,
  });
  if (error) {
    console.error("publish waiver failed", error.message);
    return { errors: { form: "We couldn't publish the waiver. Try again." } };
  }
  updateTag("waivers");
  const { data } = await supabase
    .from("waiver_versions")
    .select("version_number")
    .eq("season_id", parsed.data.season_id)
    .eq("is_current", true)
    .single();
  return { published: (data as { version_number: number } | null)?.version_number };
}
