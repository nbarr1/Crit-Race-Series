import "server-only";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in admin's Supabase client (their own session, so the audit log
 * records them), or null for anyone else. Server actions call this first;
 * the database functions check the role again.
 */
export async function adminClient() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return null;
  return { supabase: await createClient(), profile };
}

export const NOT_ADMIN = { error: "Only admins can make this change. Sign in again if your session ended." } as const;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
