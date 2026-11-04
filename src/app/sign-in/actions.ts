"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { emailSchema, otpSchema } from "@/lib/validation/profile";

export type SignInState = {
  step: "email" | "code";
  email?: string;
  error?: string;
  message?: string;
};

const TEN_MINUTES = 10 * 60 * 1000;

export async function requestCode(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = emailSchema.safeParse({ email: form.get("email") });
  if (!parsed.success) return { step: "email", error: parsed.error.issues[0]?.message };
  const { email } = parsed.data;
  const next = safeNextPath(String(form.get("next") ?? ""));

  const ip = await clientIp();
  if (!rateLimit(`otp:ip:${ip}`, 20, TEN_MINUTES).ok || !rateLimit(`otp:email:${email}`, 5, TEN_MINUTES).ok) {
    return { step: "email", email, error: "Too many sign-in attempts. Wait 10 minutes and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) {
    console.error("signInWithOtp failed", error.message);
    return { step: "email", email, error: "We couldn't send the email. Check the address and try again." };
  }
  return {
    step: "code",
    email,
    message: `We sent a sign-in link and a code to ${email}. Open the link on this device, or enter the code here.`,
  };
}

export async function verifyCode(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = otpSchema.safeParse({ email: form.get("email"), token: form.get("token") });
  const email = String(form.get("email") ?? "");
  if (!parsed.success) return { step: "code", email, error: parsed.error.issues[0]?.message };

  const ip = await clientIp();
  if (!rateLimit(`verify:ip:${ip}`, 30, TEN_MINUTES).ok || !rateLimit(`verify:email:${parsed.data.email}`, 10, TEN_MINUTES).ok) {
    return { step: "code", email, error: "Too many attempts. Wait 10 minutes and request a new code." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: parsed.data.email, token: parsed.data.token, type: "email" });
  if (error) return { step: "code", email, error: "That code didn't work. Check it, or request a new one." };

  redirect(safeNextPath(String(form.get("next") ?? "")));
}

export async function signInWithGoogle(form: FormData) {
  if (process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED !== "true") redirect("/sign-in");
  const next = safeNextPath(String(form.get("next") ?? ""));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect("/sign-in?error=google");
  redirect(data.url);
}
