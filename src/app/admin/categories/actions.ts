"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { adminClient, NOT_ADMIN } from "@/lib/admin/server";
import { adminErrorMessage, firstIssue, type AdminState } from "@/lib/admin/errors";
import { formToObject } from "@/lib/validation/profile";

const schema = z.object({
  id: z.union([z.literal(""), z.uuid()]).default(""),
  name: z.string().trim().min(1, "Enter a name.").max(60),
  description: z.string().trim().max(500).default(""),
  eligibility_notes: z.string().trim().max(500).default(""),
  min_age: z.union([z.literal(""), z.coerce.number().int().min(0, "Use an age from 0 to 120.").max(120, "Use an age from 0 to 120.")]).default(""),
  requires_gender: z.enum(["", "woman", "man", "non_binary"]).default(""),
  sort_order: z.coerce.number().int().min(0).max(9999).default(0),
});
const LABELS = { name: "Name", min_age: "Minimum age", sort_order: "Order" };

export async function saveCategory(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await adminClient();
  if (!admin) return NOT_ADMIN;
  const parsed = schema.safeParse(formToObject(form));
  if (!parsed.success) return { error: firstIssue(parsed.error, LABELS) };
  const v = parsed.data;
  const { error } = await admin.supabase.rpc("admin_save_category", {
    p_id: v.id || null,
    p_name: v.name,
    p_description: v.description,
    p_eligibility_notes: v.eligibility_notes,
    p_min_age: v.min_age === "" ? null : v.min_age,
    p_requires_gender: v.requires_gender || null,
    p_sort_order: v.sort_order,
  });
  if (error) return { error: adminErrorMessage(error.message) };
  updateTag("events");
  updateTag("results");
  revalidatePath("/admin/categories");
  return { message: v.id ? `Saved ${v.name}.` : `Added ${v.name}. Add it to events on the Events page.` };
}
