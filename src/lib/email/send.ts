import "server-only";
import { createHash } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";

export type EmailAttachment = { filename: string; content: Uint8Array | Buffer };
export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  /**
   * A stable key for this message. It becomes the Message-ID header, so a
   * retried send carries the same ID as the first attempt (DECISIONS.md D-065).
   */
  idempotencyKey?: string;
};

type SmtpSettings = { host: string; port: number; user: string; pass: string; from: string };

/**
 * SMTP settings from the environment. Defaults suit Gmail with an app
 * password: smtp.gmail.com on port 465, sending as SMTP_USER.
 * Returns null when SMTP_USER or SMTP_PASSWORD is missing.
 */
export function smtpSettings(env: Record<string, string | undefined> = process.env): SmtpSettings | null {
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASSWORD?.replace(/\s+/g, "");
  if (!user || !pass) return null;
  return {
    host: env.SMTP_HOST?.trim() || "smtp.gmail.com",
    port: Number(env.SMTP_PORT) || 465,
    user,
    pass,
    from: env.EMAIL_FROM?.trim() || user,
  };
}

let transport: Transporter | null = null;
let transportKey = "";

function getTransport(s: SmtpSettings): Transporter {
  const key = `${s.host}:${s.port}:${s.user}`;
  if (!transport || key !== transportKey) {
    transport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.port === 465,
      auth: { user: s.user, pass: s.pass },
      pool: true,
      maxConnections: 3,
    });
    transportKey = key;
  }
  return transport;
}

/** A Message-ID built from the idempotency key and the sender's domain. */
export function messageId(key: string, from: string): string {
  const domain = /@([^>\s]+)>?\s*$/.exec(from)?.[1] ?? "localhost";
  return `<${createHash("sha256").update(key).digest("hex").slice(0, 32)}@${domain}>`;
}

/**
 * Sends one email over SMTP (Gmail by default). Without SMTP_USER and
 * SMTP_PASSWORD (local development), the message is logged instead, so flows
 * still complete. Returns true when the message was accepted or logged.
 */
export async function sendEmail(msg: EmailMessage): Promise<boolean> {
  if (isReservedAddress(msg.to)) {
    console.info(`[email skipped: reserved test domain] to=${msg.to} subject="${msg.subject}"`);
    return true;
  }
  const smtp = smtpSettings();
  if (!smtp) {
    console.info(`[email skipped: SMTP_USER or SMTP_PASSWORD not set] to=${msg.to} subject="${msg.subject}"`);
    return true;
  }
  try {
    await getTransport(smtp).sendMail({
      from: smtp.from,
      to: msg.to,
      replyTo: process.env.EMAIL_REPLY_TO || undefined,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content) })),
      messageId: msg.idempotencyKey ? messageId(msg.idempotencyKey, smtp.from) : undefined,
    });
    return true;
  } catch (err) {
    console.error("email send failed", msg.subject, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Sends many messages, one per recipient, so riders never see each other's
 * addresses. Reserved test domains are skipped. Returns how many were accepted.
 */
export async function sendBatch(messages: Omit<EmailMessage, "attachments">[], idempotencyPrefix: string): Promise<number> {
  const real = messages.filter((m) => !isReservedAddress(m.to));
  if (!smtpSettings()) {
    console.info(`[email skipped: SMTP_USER or SMTP_PASSWORD not set] batch of ${real.length} "${messages[0]?.subject ?? ""}"`);
    return real.length;
  }
  let accepted = 0;
  for (const m of real) {
    if (await sendEmail({ ...m, idempotencyKey: `${idempotencyPrefix}/${m.to}` })) accepted++;
  }
  return accepted;
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
