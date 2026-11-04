import "server-only";
import { Resend } from "resend";

export type EmailAttachment = { filename: string; content: Uint8Array | Buffer };
export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  /** Resend uses this to drop duplicate sends of the same message. */
  idempotencyKey?: string;
};

let client: Resend | null = null;

/**
 * Sends one email through Resend. Without RESEND_API_KEY (local development),
 * the message is logged instead, so flows still complete.
 * Returns true when the message was accepted or logged.
 */
export async function sendEmail(msg: EmailMessage): Promise<boolean> {
  if (isReservedAddress(msg.to)) {
    console.info(`[email skipped: reserved test domain] to=${msg.to} subject="${msg.subject}"`);
    return true;
  }
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    console.info(`[email skipped: RESEND_API_KEY or EMAIL_FROM not set] to=${msg.to} subject="${msg.subject}"`);
    return true;
  }
  client ??= new Resend(key);
  const { error } = await client.emails.send(
    {
      from,
      to: msg.to,
      replyTo: process.env.EMAIL_REPLY_TO || undefined,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content) })),
    },
    msg.idempotencyKey ? { idempotencyKey: msg.idempotencyKey } : undefined,
  );
  if (error) {
    console.error("email send failed", msg.subject, error.message);
    return false;
  }
  return true;
}

/**
 * Reserved domains (RFC 2606 and RFC 6761) can never receive mail. Seeded demo
 * riders use them, so skipping them avoids bounces that hurt the sender's
 * reputation.
 */
export function isReservedAddress(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return /(^|\.)(test|example|invalid|localhost)$/.test(domain) || /^example\.(com|net|org)$/.test(domain);
}
