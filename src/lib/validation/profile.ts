import { z } from "zod";

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const phone = z
  .string()
  .trim()
  .min(7, "Enter a phone number with area code.")
  .max(30)
  .regex(/^[0-9+().\-\s]+$/, "Use digits, spaces, and + ( ) - only.");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker or YYYY-MM-DD.");

export const GENDERS = ["woman", "man", "non_binary", "prefer_not_to_say"] as const;

/** Fields a rider must provide before they can register. */
export const profileSchema = z
  .object({
    first_name: trimmed(80).min(1, "Enter your first name."),
    last_name: trimmed(80).min(1, "Enter your last name."),
    display_name: trimmed(80).optional().default(""),
    phone,
    birth_date: isoDate.refine((v) => {
      const d = new Date(`${v}T12:00:00Z`);
      const year = d.getUTCFullYear();
      return !Number.isNaN(d.getTime()) && year >= 1900 && d.getTime() < Date.now();
    }, "Enter a valid birth date."),
    gender: z
      .enum(GENDERS)
      .or(z.literal("").transform(() => null))
      .nullable()
      .optional(),
    team: optionalText(120),
    usac_license_number: optionalText(20),
    usac_license_expiry: isoDate.or(z.literal("").transform(() => null)).nullable().optional(),
    emergency_contact_name: trimmed(120).min(1, "Enter an emergency contact name."),
    emergency_contact_relationship: trimmed(60).min(1, "Enter how this person is related to you."),
    emergency_contact_phone: phone,
  })
  .transform((p) => ({
    ...p,
    display_name: p.display_name || `${p.first_name} ${p.last_name.charAt(0)}.`,
  }));

export type ProfileInput = z.input<typeof profileSchema>;
export type ProfileValues = z.output<typeof profileSchema>;

/** Reads a FormData into a plain object for Zod. */
export function formToObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    out[key] ??= issue.message;
  }
  return out;
}

/** A profile is complete when every field the registration flow needs is set. */
export function isProfileComplete(p: {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  birth_date: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
}): boolean {
  return Boolean(
    p.first_name &&
      p.last_name &&
      p.phone &&
      p.birth_date &&
      p.emergency_contact_name &&
      p.emergency_contact_phone &&
      p.emergency_contact_relationship,
  );
}

export const emailSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
});

export const otpSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  token: z
    .string()
    .trim()
    .regex(/^\d{6,10}$/, "Enter the code from your email."),
});
