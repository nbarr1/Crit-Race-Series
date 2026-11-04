import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { isReservedAddress, sendEmail } = await import("@/lib/email/send");

describe("sendEmail", () => {
  it("recognizes reserved test domains", () => {
    expect(isReservedAddress("rider01@example.test")).toBe(true);
    expect(isReservedAddress("a@example.com")).toBe(true);
    expect(isReservedAddress("a@foo.invalid")).toBe(true);
    expect(isReservedAddress("rider@gmail.com")).toBe(false);
    expect(isReservedAddress("a@example.community")).toBe(false);
  });

  it("never sends to a reserved domain, even with Resend configured", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Series <races@example.org>";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await sendEmail({ to: "rider01@example.test", subject: "s", html: "h", text: "t" })).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
  });
});
