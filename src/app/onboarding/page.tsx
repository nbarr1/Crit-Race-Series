import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { redirect } from "next/navigation";
import { requireSignedIn, safeNextPath } from "@/lib/auth";
import { isProfileComplete } from "@/lib/validation/profile";
import { ProfileForm } from "@/components/profile/profile-form";

export const metadata: Metadata = { title: "Set up your rider profile" };

type Props = { searchParams: Promise<{ next?: string }> };

async function Onboarding({ searchParams }: Props) {
  const next = safeNextPath((await searchParams).next);
  const profile = await requireSignedIn("/onboarding");
  if (isProfileComplete(profile) && profile.onboarded_at) redirect(next);

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Set up your rider profile</h1>
      <p>Race staff need these details before you can register. You can change them later on your profile page.</p>
      <ProfileForm profile={profile} next={next} submitLabel="Save and continue" />
    </div>
  );
}

export default function Page({ searchParams }: Props) {
  return (
    <Suspense fallback={<PageLoading label="Loading your profile" />}>
        <Onboarding searchParams={searchParams} />
      </Suspense>
  );
}
