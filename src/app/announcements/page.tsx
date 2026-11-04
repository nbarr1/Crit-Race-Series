import type { Metadata } from "next";
import { Suspense } from "react";
import { getAnnouncements } from "@/lib/data";
import { AnnouncementList } from "@/components/event/announcement-list";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Announcements" };

async function Feed() {
  return <AnnouncementList items={await getAnnouncements()} />;
}

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Announcements</h1>
      <p className="text-muted-foreground">Urgent notices are listed first.</p>
      <Suspense fallback={<PageLoading label="Loading announcements" />}>
        <Feed />
      </Suspense>
    </div>
  );
}
