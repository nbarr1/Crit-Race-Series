"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, safeNextPath } from "@/lib/auth";
import { fieldErrors, formToObject, profileSchema } from "@/lib/validation/profile";

export type ProfileFormState = { errors?: Record<string, string>; saved?: boolean };

export async function saveProfile(_prev: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/sign-in");

  const parsed = profileSchema.safeParse(formToObject(form));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  // RLS limits this update to the caller's own row; role and email aren't
  // writable through the API at all.
  const { error } = await supabase
    .from("profiles")
    .update({ ...parsed.data, onboarded_at: profile.onboarded_at ?? new Date().toISOString() })
    .eq("id", profile.id);
  if (error) {
    console.error("profile update failed", error.message);
    return { errors: { form: "We couldn't save your profile. Try again." } };
  }

  revalidatePath("/", "layout");
  const next = form.get("next");
  if (typeof next === "string" && next) redirect(safeNextPath(next));
  return { saved: true };
}
