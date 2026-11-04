import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Staff" };

async function StaffHome() {
  const profile = await requireStaff("/staff");
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Staff tools</h1>
      <p>Signed in as {profile.role}. Check-in, walk-ups, and results upload arrive in later build phases.</p>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PageLoading label="Loading" />}>
        <StaffHome />
      </Suspense>
  );
}
