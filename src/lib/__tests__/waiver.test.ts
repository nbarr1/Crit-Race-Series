import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { markdownToBlocks, wrapText } from "@/lib/markdown-text";
import { buildWaiverPdf } from "@/lib/waiver-pdf";
import { needsGuardian, normalizeName, signatureSchema } from "@/lib/validation/waiver";
import { SAMPLE_WAIVER_BODY } from "@/lib/sample-waiver";

const adult = { first_name: "Rita", last_name: "O'Neil", birth_date: "1990-04-02" };
const minor = { first_name: "Sam", last_name: "Young", birth_date: "2011-06-01" };
const VID = "6f1c1d3e-8f0a-4b1e-9b0a-1234567890ab";

describe("markdownToBlocks", () => {
  it("keeps headings, numbered items, and paragraphs, and strips emphasis", () => {
    const blocks = markdownToBlocks("# Title\n\nSome **bold** text\ncontinues.\n\n1. **Risks.** Crashes happen.\n- A [link](https://x.test)");
    expect(blocks).toEqual([
      { kind: "heading", text: "Title" },
      { kind: "paragraph", text: "Some bold text continues." },
      { kind: "item", marker: "1.", text: "Risks. Crashes happen." },
      { kind: "item", marker: "•", text: "A link (https://x.test)" },
    ]);
  });

  it("wraps text to a width", () => {
    expect(wrapText("aa bb cc dd", 5, (s) => s.length)).toEqual(["aa bb", "cc dd"]);
    expect(wrapText("averyveryverylongword x", 5, (s) => s.length)).toEqual(["averyveryverylongword", "x"]);
  });
});

describe("buildWaiverPdf", () => {
  it("produces a valid PDF with the waiver and signature details", async () => {
    const bytes = await buildWaiverPdf({
      seriesName: "Test Series",
      waiverTitle: "Test waiver",
      versionNumber: 2,
      bodyMarkdown: SAMPLE_WAIVER_BODY.repeat(4), // long enough for a second page
      riderName: "Sam Young",
      riderBirthDate: "2011-06-01",
      typedFullName: "Sam Young",
      signedAt: "2027-05-01T14:00:00.000Z",
      ipAddress: "203.0.113.5",
      userAgent: "Mozilla/5.0 “quoted” — test",
      signatureId: "sig-1",
      guardian: { name: "Pat Young", relationship: "Parent", typedSignature: "Pat Young" },
      collectedBy: null,
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toBe("Test waiver - Sam Young");
  });
});

describe("signature validation", () => {
  it("normalizes names for comparison", () => {
    expect(normalizeName("  Rita  O'Neil ")).toBe("rita o neil");
    expect(normalizeName("RITA O NEIL")).toBe("rita o neil");
  });

  it("requires the agree box and a name that matches the profile", () => {
    const schema = signatureSchema(adult, "2027-05-01");
    expect(schema.safeParse({ waiver_version_id: VID, typed_full_name: "rita o'neil", agree: "on" }).success).toBe(true);
    const wrong = schema.safeParse({ waiver_version_id: VID, typed_full_name: "Someone Else", agree: "on" });
    expect(wrong.success).toBe(false);
    expect(wrong.error!.issues[0].path).toEqual(["typed_full_name"]);
    expect(schema.safeParse({ waiver_version_id: VID, typed_full_name: "Rita O'Neil" }).success).toBe(false);
  });

  it("does not ask adults for a guardian", () => {
    const r = signatureSchema(adult, "2027-05-01").parse({ waiver_version_id: VID, typed_full_name: "Rita O'Neil", agree: "on" });
    expect(r.guardian).toBeNull();
  });

  it("requires a guardian for riders under 18 on the signing date", () => {
    expect(needsGuardian(minor.birth_date, "2027-05-01")).toBe(true);
    expect(needsGuardian(minor.birth_date, "2029-06-01")).toBe(false);
    const schema = signatureSchema(minor, "2027-05-01");
    const missing = schema.safeParse({ waiver_version_id: VID, typed_full_name: "Sam Young", agree: "on" });
    expect(missing.success).toBe(false);
    const paths = missing.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["guardian_name", "guardian_relationship", "guardian_typed_signature", "guardian_agree"]));
    const ok = schema.parse({
      waiver_version_id: VID,
      typed_full_name: "Sam Young",
      agree: "on",
      guardian_name: "Pat Young",
      guardian_relationship: "Parent",
      guardian_typed_signature: "pat young",
      guardian_agree: "on",
    });
    expect(ok.guardian).toEqual({ name: "Pat Young", relationship: "Parent", typedSignature: "pat young" });
  });

  it("rejects a guardian signature that doesn't match the guardian's name", () => {
    const r = signatureSchema(minor, "2027-05-01").safeParse({
      waiver_version_id: VID,
      typed_full_name: "Sam Young",
      agree: "on",
      guardian_name: "Pat Young",
      guardian_relationship: "Parent",
      guardian_typed_signature: "Sam Young",
      guardian_agree: "on",
    });
    expect(r.success).toBe(false);
  });
});
