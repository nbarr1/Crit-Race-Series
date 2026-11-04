import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { sendBatch } from "@/lib/email/send";
import { announcementEmail } from "@/lib/email/templates";
import { markdownToBlocks } from "@/lib/markdown-text";

type Row = {
  id: string;
  title: string;
  body_markdown: string;
  event_id: string | null;
  priority: "normal" | "urgent";
  publish_at: string;
  send_email: boolean;
  email_audience: "event_registrants" | "season" | null;
  emailed_at: string | null;
};

/**
 * Emails an announcement to its audience once. The row is claimed first
 * (emailed_at set where it was null), so a retry or a second caller can't send
 * it twice. `client` is the caller's: a staff session, or the service role
 * from the scheduled job.
 */
export async function emailAnnouncement(client: SupabaseClient, announcementId: string): Promise<number | null> {
  const { data: claimed } = await client
    .from("announcements")
    .update({ emailed_at: new Date().toISOString() })
    .eq("id", announcementId)
    .eq("send_email", true)
    .is("emailed_at", null)
    .lte("publish_at", new Date().toISOString())
    .select("id, title, body_markdown, event_id, priority, publish_at, send_email, email_audience, emailed_at")
    .maybeSingle();
  const a = claimed as Row | null;
  if (!a || !a.email_audience) return null;

  const { data: recipients, error } = await client.rpc("announcement_recipients", { p_announcement_id: a.id });
  if (error) {
    // Release the claim so the scheduled job retries.
    await client.from("announcements").update({ emailed_at: null }).eq("id", a.id);
    throw new Error(`recipients: ${error.message}`);
  }
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const url = a.event_id ? `${site}/events/${a.event_id}` : `${site}/announcements`;
  const bodyText = markdownToBlocks(a.body_markdown)
    .map((b) => (b.kind === "item" ? `${b.marker} ${b.text}` : b.text))
    .join("\n\n");
  const list = (recipients ?? []) as { email: string; first_name: string }[];
  const sent = await sendBatch(
    list.map((r) => ({ to: r.email, ...announcementEmail(r.first_name || "rider", a.title, bodyText, url, a.priority === "urgent") })),
    `announcement/${a.id}`,
  );
  await client.from("announcements").update({ email_recipient_count: list.length }).eq("id", a.id);
  return sent;
}

/** For the scheduled job: announcements whose publish time arrived but haven't been emailed. */
export async function emailDueAnnouncements(): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("announcements")
    .select("id")
    .eq("send_email", true)
    .is("emailed_at", null)
    .is("deleted_at", null)
    .lte("publish_at", new Date().toISOString())
    .limit(10);
  let n = 0;
  for (const { id } of (data ?? []) as { id: string }[]) {
    try {
      if ((await emailAnnouncement(admin, id)) !== null) n++;
    } catch (err) {
      console.error("announcement email failed", id, err instanceof Error ? err.message : err);
    }
  }
  return n;
}
