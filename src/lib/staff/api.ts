import "server-only";
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import type { Profile } from "@/lib/types";

/** For staff JSON routes: returns the profile, or a response to send back. */
export async function staffOrResponse(): Promise<{ profile: Profile } | { response: NextResponse }> {
  const profile = await getCurrentProfile();
  if (!profile) return { response: NextResponse.json({ error: "signed_out" }, { status: 401 }) };
  if (profile.role !== "staff" && profile.role !== "admin") {
    return { response: NextResponse.json({ error: "staff_only" }, { status: 403 }) };
  }
  return { profile };
}

export const NO_STORE = { "cache-control": "no-store" } as const;
