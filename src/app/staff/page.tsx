import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Staff" };

async function StaffHome() {
  const profile = await requireStaff("/staff");
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Staff tools</h1>
      <p>Signed in as {profile.role}.</p>
      <Link href="/staff/check-in" className={buttonVariants({ size: "lg" })}>
        Open race-day check-in
      </Link>
      <p className="text-sm text-muted-foreground">Check-in works offline once you&apos;ve opened it with a signal. Results upload arrives in a later build phase.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <Link href="/staff/announcements" className="font-semibold text-primary underline">Announcements: post and email riders</Link>
        </li>
        <li>
          <Link href="/staff/sponsors" className="font-semibold text-primary underline">Sponsors</Link>
        </li>
        <li>
          <Link href="/staff/events" className="font-semibold text-primary underline">Event information: course maps, GPX, weather notes</Link>
        </li>
      </ul>
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
