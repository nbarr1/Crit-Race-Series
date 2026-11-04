import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPromotionEmails } from "@/lib/registration-service";
import { finalizeSignature } from "@/lib/waiver-service";
import { emailDueAnnouncements } from "@/lib/announcement-service";

/**
 * Scheduled once a day at 11:00 UTC (vercel.json, DECISIONS.md D-067). Releases expired unpaid holds,
 * emails riders promoted from the waitlist, retries waiver PDFs and emails
 * that failed the first time, and emails scheduled announcements. Vercel Cron sends CRON_SECRET as a bearer token.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();

  const { data: promoted, error } = await admin.rpc("expire_pending_registrations");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const notified = await sendPromotionEmails();

  // Signatures from the last three days that still need a PDF, or an email
  // to a rider who has an address (walk-ups may not).
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: candidates } = await admin
    .from("waiver_signatures")
    .select("id, pdf_path, email_sent_at, rider:profiles!waiver_signatures_rider_id_fkey(email)")
    .or("pdf_path.is.null,email_sent_at.is.null")
    .lt("created_at", fiveMinutesAgo)
    .gt("created_at", threeDaysAgo)
    .limit(200);
  const unfinished = ((candidates ?? []) as unknown as {
    id: string;
    pdf_path: string | null;
    email_sent_at: string | null;
    rider: { email: string | null } | null;
  }[])
    .filter((s) => !s.pdf_path || (!s.email_sent_at && s.rider?.email))
    .slice(0, 25);
  let finalized = 0;
  for (const { id } of unfinished) {
    try {
      await finalizeSignature(id);
      finalized++;
    } catch (err) {
      console.error("finalize signature failed", id, err instanceof Error ? err.message : err);
    }
  }

  const announcementsEmailed = await emailDueAnnouncements();

  return NextResponse.json({
    announcementsEmailed,
    promoted: Array.isArray(promoted) ? promoted.length : 0,
    notified,
    waiversFinalized: finalized,
  });
}
