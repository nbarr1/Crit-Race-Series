import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { redirect } from "next/navigation";
import { getCurrentProfile, safeNextPath } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { Alert } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SignInForm } from "./sign-in-form";
import { signInWithGoogle } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

type Props = { searchParams: Promise<{ next?: string; error?: string }> };

async function SignInView({ searchParams }: Props) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNextPath(rawNext);
  if (await getCurrentProfile()) redirect(next);
  const google = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-3xl font-bold">Sign in</h1>
      {!isSupabaseConfigured() ? <SetupNotice /> : null}
      {error ? <Alert tone="error">That sign-in link expired or was already used. Request a new code.</Alert> : null}
      <SignInForm next={next} />
      {google ? (
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={next} />
          <Button type="submit" variant="secondary" size="lg" className="w-full">
            Continue with Google
          </Button>
        </form>
      ) : null}
      <p className="text-sm text-muted-foreground">
        New here? Signing in creates your rider account. You&apos;ll add your details and an emergency contact next.
      </p>
    </div>
  );
}

export default function Page({ searchParams }: Props) {
  return (
    <Suspense fallback={<PageLoading label="Loading" />}>
        <SignInView searchParams={searchParams} />
      </Suspense>
  );
}
