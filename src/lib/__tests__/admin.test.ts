import { describe, expect, it } from "vitest";
import { z } from "zod";
import { adminErrorMessage, firstIssue } from "@/lib/admin/errors";
import { changedFields } from "@/lib/admin/audit";
import { parsePointsText, pointsToText } from "@/lib/admin/points";

describe("admin error messages", () => {
  it("maps database error codes to sentences", () => {
    expect(adminErrorMessage("category_in_use")).toMatch(/capacity to 0/);
    expect(adminErrorMessage("admin_only")).toBe("Only admins can make this change.");
    expect(adminErrorMessage("admins cannot remove their own admin role")).toMatch(/another admin/);
  });

  it("falls back to a generic message", () => {
    expect(adminErrorMessage("connection reset")).toBe("That didn't save. Try again.");
    expect(adminErrorMessage(undefined, "Nope.")).toBe("Nope.");
  });

  it("labels the first form problem", () => {
    const r = z.object({ year: z.number({ error: "Enter a year." }) }).safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) expect(firstIssue(r.error, { year: "Year" })).toBe("Year: Enter a year.");
  });
});

describe("audit diffs", () => {
  it("lists changed fields, ignoring updated_at", () => {
    expect(changedFields({ a: 1, b: { x: 1 }, updated_at: "t1" }, { a: 2, b: { x: 1 }, updated_at: "t2" })).toEqual(["a"]);
    expect(changedFields(null, { a: 1 })).toEqual([]);
  });
});

describe("points table text", () => {
  it("round-trips a table", () => {
    const parsed = parsePointsText("25, 20 16\n13");
    expect(parsed).toEqual({ ok: true, table: { "1": 25, "2": 20, "3": 16, "4": 13 } });
    expect(pointsToText({ "1": 25, "2": 20, "3": 16, "4": 13 })).toBe("25, 20, 16, 13");
  });

  it("fills gaps with zero when showing a table", () => {
    expect(pointsToText({ "1": 10, "3": 5 })).toBe("10, 0, 5");
  });

  it("rejects bad values", () => {
    expect(parsePointsText("")).toMatchObject({ ok: false });
    expect(parsePointsText("10, 2.5")).toEqual({ ok: false, error: 'Place 2: "2.5" isn\'t a whole number from 0 to 1000.' });
    expect(parsePointsText("5000")).toMatchObject({ ok: false });
  });
});

import { readSetting, settingKind } from "@/lib/admin/settings-form";

describe("settings form", () => {
  it("chooses an input from the key and value", () => {
    expect(settingKind("payments_enabled", true)).toBe("boolean");
    expect(settingKind("default_price_cents", 2500)).toBe("money");
    expect(settingKind("external_waiver_url", null)).toBe("url");
    expect(settingKind("waitlist_offer_hours", 24)).toBe("integer");
    expect(settingKind("refund_policy", "no_automatic_refunds")).toBe("refund_policy");
  });

  it("reads submitted values", () => {
    expect(readSetting("boolean", null)).toEqual({ ok: true, value: false });
    expect(readSetting("boolean", "on")).toEqual({ ok: true, value: true });
    expect(readSetting("money", "$27.50")).toEqual({ ok: true, value: 2750 });
    expect(readSetting("integer", "45")).toEqual({ ok: true, value: 45 });
    expect(readSetting("url", "")).toEqual({ ok: true, value: null });
    expect(readSetting("integer", "-1")).toMatchObject({ ok: false });
    expect(readSetting("url", "http://insecure.example")).toMatchObject({ ok: false });
    expect(readSetting("refund_policy", "always")).toMatchObject({ ok: false });
  });
});
