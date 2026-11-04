import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import Link from "next/link";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Staff" };

async function StaffHome() {
  const profile = await requireStaff("/staff");
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Staff tools</h1>
      <p>Signed in as {profile.role}. Check-in, walk-ups, and results upload arrive in later build phases.</p>
      {profile.role === "admin" ? (
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <Link href="/admin/waivers" className="font-semibold text-primary underline">
              Waivers: publish versions and export signatures
            </Link>
          </li>
        </ul>
      ) : null}
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
