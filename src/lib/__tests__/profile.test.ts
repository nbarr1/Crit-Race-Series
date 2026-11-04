import { describe, expect, it } from "vitest";
import { emailSchema, isProfileComplete, profileSchema } from "@/lib/validation/profile";
import { safeNextPath } from "@/lib/paths";

const valid = {
  first_name: " Rita ",
  last_name: "One",
  display_name: "",
  phone: "(828) 555-0101",
  birth_date: "1990-04-02",
  gender: "",
  team: "",
  usac_license_number: "",
  usac_license_expiry: "",
  emergency_contact_name: "Sam One",
  emergency_contact_relationship: "Partner",
  emergency_contact_phone: "828-555-0102",
};

describe("profileSchema", () => {
  it("accepts a complete profile, trims, and fills a default display name", () => {
    const r = profileSchema.parse(valid);
    expect(r.first_name).toBe("Rita");
    expect(r.display_name).toBe("Rita O.");
    expect(r.gender).toBeNull();
    expect(r.team).toBeNull();
    expect(r.usac_license_expiry).toBeNull();
  });

  it("requires an emergency contact", () => {
    const r = profileSchema.safeParse({ ...valid, emergency_contact_name: "", emergency_contact_phone: "" });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path[0]);
    expect(paths).toContain("emergency_contact_name");
    expect(paths).toContain("emergency_contact_phone");
  });

  it("rejects future and malformed birth dates", () => {
    expect(profileSchema.safeParse({ ...valid, birth_date: "2999-01-01" }).success).toBe(false);
    expect(profileSchema.safeParse({ ...valid, birth_date: "04/02/1990" }).success).toBe(false);
  });

  it("rejects phone numbers with letters", () => {
    expect(profileSchema.safeParse({ ...valid, phone: "call me" }).success).toBe(false);
  });

  it("ignores fields that riders aren't allowed to set", () => {
    const r = profileSchema.parse({ ...valid, role: "admin", email: "x@y.z" });
    expect("role" in r).toBe(false);
    expect("email" in r).toBe(false);
  });
});

describe("isProfileComplete", () => {
  it("is false until every required field is set", () => {
    const base = profileSchema.parse(valid);
    expect(isProfileComplete(base)).toBe(true);
    expect(isProfileComplete({ ...base, birth_date: null })).toBe(false);
  });
});

describe("emailSchema", () => {
  it("normalizes email", () => {
    expect(emailSchema.parse({ email: " Rider@Example.COM " }).email).toBe("rider@example.com");
  });
});

describe("safeNextPath", () => {
  it("allows relative paths and blocks open redirects", () => {
    expect(safeNextPath("/events/1")).toBe("/events/1");
    expect(safeNextPath("//evil.example")).toBe("/my-races");
    expect(safeNextPath("https://evil.example")).toBe("/my-races");
    expect(safeNextPath("/\\evil.example")).toBe("/my-races");
    expect(safeNextPath(undefined)).toBe("/my-races");
  });
});
