import { z } from "zod";
import { ageOn } from "@/lib/time";

export function normalizeName(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Under 18 on the day they sign. The waiver then needs a guardian (D-054). */
export function needsGuardian(birthDate: string | null, today: string): boolean {
  return birthDate ? ageOn(birthDate, today) < 18 : false;
}

const text = (max: number, msg: string) => z.string().trim().min(1, msg).max(max);

export function signatureSchema(profile: { first_name: string; last_name: string; birth_date: string | null }, today: string) {
  const fullName = normalizeName(`${profile.first_name} ${profile.last_name}`);
  const minor = needsGuardian(profile.birth_date, today);
  return z
    .object({
      waiver_version_id: z.uuid(),
      typed_full_name: text(160, "Type your full name to sign."),
      agree: z.literal("on", { error: "Check the box to agree to the waiver." }),
      guardian_name: z.string().trim().max(160).optional().default(""),
      guardian_relationship: z.string().trim().max(60).optional().default(""),
      guardian_typed_signature: z.string().trim().max(160).optional().default(""),
      guardian_agree: z.string().optional(),
    })
    .superRefine((v, ctx) => {
      if (normalizeName(v.typed_full_name) !== fullName) {
        ctx.addIssue({
          code: "custom",
          path: ["typed_full_name"],
          message: `Type your name as it appears on your profile: ${profile.first_name} ${profile.last_name}.`,
        });
      }
      if (!minor) return;
      if (!v.guardian_name) ctx.addIssue({ code: "custom", path: ["guardian_name"], message: "Enter the parent or guardian's full name." });
      if (!v.guardian_relationship)
        ctx.addIssue({ code: "custom", path: ["guardian_relationship"], message: "Enter the guardian's relationship to the rider." });
      if (!v.guardian_typed_signature || normalizeName(v.guardian_typed_signature) !== normalizeName(v.guardian_name)) {
        ctx.addIssue({
          code: "custom",
          path: ["guardian_typed_signature"],
          message: "The parent or guardian types their full name, matching the name entered.",
        });
      }
      if (v.guardian_agree !== "on")
        ctx.addIssue({ code: "custom", path: ["guardian_agree"], message: "The parent or guardian must check the box to agree." });
    })
    .transform((v) => ({
      waiverVersionId: v.waiver_version_id,
      typedFullName: v.typed_full_name,
      guardian: minor
        ? { name: v.guardian_name, relationship: v.guardian_relationship, typedSignature: v.guardian_typed_signature }
        : null,
    }));
}

export const registrationSelectionSchema = z.object({
  event_category_ids: z
    .array(z.uuid())
    .min(1, "Pick at least one race.")
    .max(20, "Pick 20 or fewer races at a time.")
    .transform((ids) => [...new Set(ids)]),
  acknowledge: z.literal("on").optional(),
});
