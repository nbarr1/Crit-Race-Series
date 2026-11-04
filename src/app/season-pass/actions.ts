"use server";

import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveSeason } from "@/lib/data";
import { describeError, errorCode } from "@/lib/messages";
import { rateLimit } from "@/lib/rate-limit";
import { publicEnv } from "@/lib/env";
import { createCheckoutSession, stripeConfigured } from "@/lib/stripe";
import { isProfileComplete } from "@/lib/validation/profile";

export type PassState = { error?: string };

const schema = z.object({ category_ids: z.array(z.uuid()).min(1, "Pick at least one category.").max(4) });

export async function buySeasonPass(_prev: PassState, form: FormData): Promise<PassState> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/sign-in?next=/season-pass");
  if (!isProfileComplete(profile)) redirect("/onboarding?next=/season-pass");
  const parsed = schema.safeParse({ category_ids: form.getAll("category_id").map(String) });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (!rateLimit(`pass:${profile.id}`, 10, 10 * 60 * 1000).ok) return { error: "Too many attempts. Try again later." };
  if (!stripeConfigured()) return { error: describeError("season_pass_unavailable") };

  const season = await getActiveSeason();
  if (!season) return { error: describeError("season_not_open") };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("start_season_pass", { p_season_id: season.id, p_category_ids: parsed.data.category_ids })
    .single();
  if (error) {
    if (errorCode(error.message) === "waiver_required") redirect("/waiver?next=/season-pass");
    return { error: describeError(error.message) };
  }
  const pass = data as { season_pass_id: string; price_cents: number };

  const { data: cats } = await supabase.from("categories").select("name").in("id", parsed.data.category_ids);
  const names = ((cats ?? []) as { name: string }[]).map((c) => c.name).join(", ");
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  let url: string | null;
  try {
    const session = await createCheckoutSession({
      kind: "season_pass",
      profileId: profile.id,
      email: profile.email,
      items: [{ name: `${season.name} season pass`, description: names, amountCents: pass.price_cents }],
      successUrl: `${site}/season-pass?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${site}/season-pass?checkout=canceled`,
      metadata: { season_pass_id: pass.season_pass_id },
      idempotencyKey: `season-pass/${pass.season_pass_id}/${randomUUID()}`,
    });
    await createAdminClient().from("season_passes").update({ checkout_session_id: session.id }).eq("id", pass.season_pass_id);
    url = session.url;
  } catch (err) {
    console.error("season pass checkout failed", err instanceof Error ? err.message : err);
    await createAdminClient().from("season_passes").update({ status: "canceled" }).eq("id", pass.season_pass_id);
    return { error: "We couldn't start the payment. Nothing was charged. Try again." };
  }
  if (!url) return { error: "We couldn't start the payment. Try again." };
  redirect(url);
}
