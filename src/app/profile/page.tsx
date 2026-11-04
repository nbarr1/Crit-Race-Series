import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { requireSignedIn } from "@/lib/auth";
import { ProfileForm } from "@/components/profile/profile-form";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Profile" };

async function ProfileView() {
  const profile = await requireSignedIn("/profile");
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Your profile</h1>
      <p className="text-muted-foreground">Signed in as {profile.email}</p>
      <ProfileForm profile={profile} submitLabel="Save profile" />
      <form action="/auth/sign-out" method="post">
        <Button type="submit" variant="secondary" className="w-full">
          Sign out
        </Button>
      </form>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PageLoading label="Loading your profile" />}>
        <ProfileView />
      </Suspense>
  );
}
