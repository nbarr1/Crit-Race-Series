import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

vi.mock("server-only", () => ({}));
const applyPaidCheckout = vi.fn();
const releaseCheckout = vi.fn();
vi.mock("@/lib/registration-service", () => ({ applyPaidCheckout, releaseCheckout }));

process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

const { POST } = await import("../route");

function signedRequest(payload: object, secret = process.env.STRIPE_WEBHOOK_SECRET!) {
  const body = JSON.stringify(payload);
  const header = new Stripe("sk_test_dummy").webhooks.generateTestHeaderString({ payload: body, secret });
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    body,
    headers: { "stripe-signature": header, "content-type": "application/json" },
  });
}

const event = (type: string, object: object) => ({ id: "evt_1", object: "event", type, data: { object } });

describe("Stripe webhook", () => {
  beforeEach(() => {
    applyPaidCheckout.mockReset();
    releaseCheckout.mockReset();
  });

  it("rejects requests without a signature", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: "{}" }) as never);
    expect(res.status).toBe(400);
    expect(applyPaidCheckout).not.toHaveBeenCalled();
  });

  it("rejects a signature made with the wrong secret", async () => {
    const res = await POST(signedRequest(event("checkout.session.completed", { id: "cs_1" }), "whsec_wrong") as never);
    expect(res.status).toBe(400);
    expect(applyPaidCheckout).not.toHaveBeenCalled();
  });

  it("applies a completed checkout", async () => {
    const res = await POST(signedRequest(event("checkout.session.completed", { id: "cs_1", payment_status: "paid" })) as never);
    expect(res.status).toBe(200);
    expect(applyPaidCheckout).toHaveBeenCalledWith(expect.objectContaining({ id: "cs_1" }));
  });

  it("releases holds for an expired checkout", async () => {
    const res = await POST(signedRequest(event("checkout.session.expired", { id: "cs_2" })) as never);
    expect(res.status).toBe(200);
    expect(releaseCheckout).toHaveBeenCalledWith("cs_2");
  });

  it("returns 500 so Stripe retries when the handler fails", async () => {
    applyPaidCheckout.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(signedRequest(event("checkout.session.completed", { id: "cs_3" })) as never);
    expect(res.status).toBe(500);
  });

  it("acknowledges events it doesn't handle", async () => {
    const res = await POST(signedRequest(event("customer.created", { id: "cus_1" })) as never);
    expect(res.status).toBe(200);
  });
});
