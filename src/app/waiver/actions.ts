"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentProfile, safeNextPath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getActiveSeason, getCurrentWaiver } from "@/lib/data";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp, userAgent } from "@/lib/request";
import { todayInDisplayTz } from "@/lib/time";
import { fieldErrors, formToObject, isProfileComplete } from "@/lib/validation/profile";
import { signatureSchema } from "@/lib/validation/waiver";
import { finalizeSignature, recordSignature } from "@/lib/waiver-service";

export type SignState = { errors?: Record<string, string> };

export async function signWaiver(_prev: SignState, form: FormData): Promise<SignState> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/sign-in?next=/waiver");
  if (!isProfileComplete(profile)) redirect("/onboarding?next=/waiver");

  const ip = await clientIp();
  if (!rateLimit(`waiver:${profile.id}`, 10, 10 * 60 * 1000).ok) {
    return { errors: { form: "Too many attempts. Wait a few minutes and try again." } };
  }

  const parsed = signatureSchema(profile, todayInDisplayTz()).safeParse(formToObject(form));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const season = await getActiveSeason();
  const waiver = season ? await getCurrentWaiver(season.id) : null;
  if (!season || !waiver) return { errors: { form: "There's no waiver to sign yet." } };
  if (waiver.id !== parsed.data.waiverVersionId) {
    return { errors: { form: "The waiver changed while you were reading it. Read the new version and sign again." } };
  }

  // Already signed this version? Read through RLS as the rider.
  const supabase = await createClient();
  const { data: status } = await supabase.rpc("my_waiver_status", { p_season_id: season.id }).single();
  if (!(status as { signed: boolean } | null)?.signed) {
    const signatureId = await recordSignature({
      riderId: profile.id,
      waiverVersionId: waiver.id,
      typedFullName: parsed.data.typedFullName,
      ipAddress: ip,
      userAgent: await userAgent(),
      guardian: parsed.data.guardian,
    });
    try {
      await finalizeSignature(signatureId);
    } catch (err) {
      // The signature is valid without the PDF. The scheduled job retries.
      console.error("waiver PDF or email failed", signatureId, err instanceof Error ? err.message : err);
    }
  }

  revalidatePath("/waiver");
  revalidatePath("/my-races");
  redirect(safeNextPath(String(form.get("next") ?? ""), "/my-races?signed=1"));
}
