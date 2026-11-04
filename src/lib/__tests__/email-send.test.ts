import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));
const { isReservedAddress, messageId, sendBatch, sendEmail, smtpSettings } = await import("@/lib/email/send");

const gmail = { SMTP_USER: "series@gmail.com", SMTP_PASSWORD: "abcd efgh ijkl mnop" };

afterEach(() => {
  for (const k of ["SMTP_USER", "SMTP_PASSWORD", "SMTP_HOST", "SMTP_PORT", "EMAIL_FROM", "EMAIL_REPLY_TO"]) delete process.env[k];
  sendMail.mockReset();
  vi.restoreAllMocks();
});

describe("smtpSettings", () => {
  it("defaults to Gmail on port 465 and sends as the SMTP user", () => {
    expect(smtpSettings(gmail)).toEqual({ host: "smtp.gmail.com", port: 465, user: "series@gmail.com", pass: "abcdefghijklmnop", from: "series@gmail.com" });
  });

  it("uses EMAIL_FROM and a custom host when set", () => {
    const s = smtpSettings({ ...gmail, EMAIL_FROM: "Connestee Crit Series <series@gmail.com>", SMTP_HOST: "smtp.example.org", SMTP_PORT: "587" });
    expect(s).toMatchObject({ host: "smtp.example.org", port: 587, from: "Connestee Crit Series <series@gmail.com>" });
  });

  it("is null without a user or password", () => {
    expect(smtpSettings({ SMTP_USER: "series@gmail.com" })).toBeNull();
    expect(smtpSettings({ SMTP_PASSWORD: "x" })).toBeNull();
  });
});

describe("sendEmail", () => {
  it("recognizes reserved test domains", () => {
    expect(isReservedAddress("rider01@example.test")).toBe(true);
    expect(isReservedAddress("a@example.com")).toBe(true);
    expect(isReservedAddress("a@foo.invalid")).toBe(true);
    expect(isReservedAddress("rider@gmail.com")).toBe(false);
    expect(isReservedAddress("a@example.community")).toBe(false);
  });

  it("never sends to a reserved domain, even with SMTP configured", async () => {
    Object.assign(process.env, gmail);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await sendEmail({ to: "rider01@example.test", subject: "s", html: "h", text: "t" })).toBe(true);
    expect(sendMail).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
  });

  it("logs instead of sending when SMTP isn't configured", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await sendEmail({ to: "rider@gmail.com", subject: "s", html: "h", text: "t" })).toBe(true);
    expect(sendMail).not.toHaveBeenCalled();
    expect(info.mock.calls[0][0]).toContain("SMTP_USER or SMTP_PASSWORD not set");
  });

  it("sends through SMTP with a stable Message-ID and attachments", async () => {
    Object.assign(process.env, gmail, { EMAIL_REPLY_TO: "races@gmail.com" });
    sendMail.mockResolvedValue({});
    const ok = await sendEmail({
      to: "rider@gmail.com",
      subject: "Your waiver",
      html: "<p>h</p>",
      text: "t",
      attachments: [{ filename: "waiver.pdf", content: new Uint8Array([1, 2]) }],
      idempotencyKey: "waiver/1",
    });
    expect(ok).toBe(true);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: "series@gmail.com", pass: "abcdefghijklmnop" } }));
    const mail = sendMail.mock.calls[0][0];
    expect(mail).toMatchObject({ from: "series@gmail.com", to: "rider@gmail.com", replyTo: "races@gmail.com", subject: "Your waiver" });
    expect(mail.attachments[0].filename).toBe("waiver.pdf");
    expect(mail.messageId).toBe(messageId("waiver/1", "series@gmail.com"));
  });

  it("returns false when the SMTP server rejects the message", async () => {
    Object.assign(process.env, gmail);
    sendMail.mockRejectedValue(new Error("535 bad credentials"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendEmail({ to: "rider@gmail.com", subject: "s", html: "h", text: "t" })).toBe(false);
  });
});

describe("messageId", () => {
  it("is the same for the same key and uses the sender's domain", () => {
    const a = messageId("promoted/1", "Series <series@gmail.com>");
    expect(a).toBe(messageId("promoted/1", "Series <series@gmail.com>"));
    expect(a).toMatch(/^<[0-9a-f]{32}@gmail\.com>$/);
    expect(messageId("promoted/2", "series@gmail.com")).not.toBe(a);
  });
});

describe("sendBatch", () => {
  it("sends one message per real recipient and counts the accepted ones", async () => {
    Object.assign(process.env, gmail);
    sendMail.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("rate limited"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = { subject: "Course change", html: "h", text: "t" };
    const n = await sendBatch(
      [{ to: "a@gmail.com", ...msg }, { to: "b@gmail.com", ...msg }, { to: "c@example.test", ...msg }],
      "announcement/1",
    );
    expect(n).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls.map((c) => c[0].to)).toEqual(["a@gmail.com", "b@gmail.com"]);
  });
});
