import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { isProfileComplete } from "@/lib/validation/profile";
import type { Profile } from "@/lib/types";

const PROFILE_COLUMNS =
  "id, user_id, first_name, last_name, display_name, email, phone, birth_date, gender, team, usac_license_number, usac_license_expiry, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone, role, onboarded_at";

/**
 * The signed-in user's profile, or null. getClaims() verifies the JWT, so the
 * user ID can be trusted. Cached per request.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  // Always request-time: the answer depends on the visitor's cookies.
  await connection();
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const { data } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as Profile | null) ?? null;
});

/** For rider pages: signed in, and onboarding finished. */
export async function requireRider(nextPath: string): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`);
  if (!isProfileComplete(profile)) redirect(`/onboarding?next=${encodeURIComponent(nextPath)}`);
  return profile;
}

/** Signed in, with or without a finished profile (used by onboarding itself). */
export async function requireSignedIn(nextPath: string): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`);
  return profile;
}

export async function requireStaff(nextPath: string): Promise<Profile> {
  const profile = await requireSignedIn(nextPath);
  if (profile.role !== "staff" && profile.role !== "admin") redirect("/");
  return profile;
}

export async function requireAdmin(nextPath: string): Promise<Profile> {
  const profile = await requireSignedIn(nextPath);
  if (profile.role !== "admin") redirect("/");
  return profile;
}

export { safeNextPath } from "@/lib/paths";
