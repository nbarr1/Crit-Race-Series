import { describe, expect, it } from "vitest";
import { describeError, describeWarning, errorCode } from "@/lib/messages";
import { csvCell, toCsv } from "@/lib/csv";
import { parseSettings, DEFAULT_SETTINGS } from "@/lib/settings-parse";
import { registrationEmail, promotedEmail } from "@/lib/email/templates";
import { registrationSelectionSchema } from "@/lib/validation/waiver";

describe("messages", () => {
  it("describes eligibility warnings", () => {
    expect(describeWarning("min_age:40")).toContain("40 or older");
    expect(describeWarning("gender:woman")).toContain("women");
    expect(describeWarning("something_new")).toContain("Staff will check");
  });

  it("maps database error codes and hides unknown ones", () => {
    expect(describeError("waiver_required")).toBe("Sign this season's waiver before you register.");
    expect(errorCode("registration_closed")).toBe("registration_closed");
    expect(describeError('duplicate key value violates unique constraint "x"')).toContain("Something went wrong");
    expect(errorCode("permission denied")).toBe("unknown");
  });
});

describe("csv", () => {
  it("quotes and escapes", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12)).toBe("12");
  });

  it("blocks spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });

  it("joins rows with CRLF", () => {
    expect(toCsv(["a", "b"], [[1, 2]])).toBe("a,b\r\n1,2\r\n");
  });
});

describe("parseSettings", () => {
  it("reads typed values and falls back to defaults", () => {
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS);
    const s = parseSettings([
      { key: "payments_enabled", value: false },
      { key: "refund_policy", value: "full_refund_before_close" },
      { key: "waitlist_offer_hours", value: 12 },
      { key: "external_waiver_url", value: "https://usac.example/waiver" },
      { key: "minors_allowed", value: "nope" },
    ]);
    expect(s.paymentsEnabled).toBe(false);
    expect(s.refundPolicy).toBe("full_refund_before_close");
    expect(s.waitlistOfferHours).toBe(12);
    expect(s.externalWaiverUrl).toBe("https://usac.example/waiver");
    expect(s.minorsAllowed).toBe(true);
  });
});

describe("email templates", () => {
  const race = {
    eventName: "Race <1>",
    eventDate: "2027-05-12",
    categoryName: "B",
    startAt: "2027-05-12T21:15:00Z",
    status: "confirmed" as const,
    amountPaidCents: 2500,
  };

  it("escapes HTML and includes a plain-text part", () => {
    const m = registrationEmail("Ann & Co", [race], "https://site.test/my-races");
    expect(m.html).toContain("Race &lt;1&gt;");
    expect(m.html).toContain("Ann &amp; Co");
    expect(m.text).toContain("Race <1>, B: Wed, May 12, 5:15 PM. Confirmed, paid $25.00.");
    expect(m.subject).toBe("You're registered: Race <1>");
  });

  it("says waitlist when every race is waitlisted", () => {
    const m = registrationEmail("Ann", [{ ...race, status: "waitlisted", waitlistPosition: 3 }], "https://x.test");
    expect(m.subject.startsWith("You're on the waitlist")).toBe(true);
    expect(m.text).toContain("Waitlist (position 3)");
  });

  it("asks promoted riders to pay within the offer window", () => {
    const m = promotedEmail("Ann", { ...race, status: "pending_payment" }, "https://x.test/my-races", 24);
    expect(m.text).toContain("Pay within 24 hours");
    expect(m.html).toContain("Pay and confirm");
  });
});

describe("registrationSelectionSchema", () => {
  it("dedupes and validates IDs", () => {
    const id = "6f1c1d3e-8f0a-4b1e-9b0a-1234567890ab";
    expect(registrationSelectionSchema.parse({ event_category_ids: [id, id] }).event_category_ids).toEqual([id]);
    expect(registrationSelectionSchema.safeParse({ event_category_ids: ["nope"] }).success).toBe(false);
    expect(registrationSelectionSchema.safeParse({ event_category_ids: [] }).success).toBe(false);
  });
});

