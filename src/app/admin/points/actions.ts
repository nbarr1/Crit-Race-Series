"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { adminClient, NOT_ADMIN } from "@/lib/admin/server";
import { adminErrorMessage, firstIssue, type AdminState } from "@/lib/admin/errors";
import { parsePointsText } from "@/lib/admin/points";
import { formToObject } from "@/lib/validation/profile";

const schema = z.object({
  id: z.union([z.literal(""), z.uuid()]).default(""),
  name: z.string().trim().min(2, "Enter a name.").max(120),
  points: z.string().max(5000),
  drop_worst_n: z.coerce.number().int().min(0, "Use 0 to 20.").max(20, "Use 0 to 20."),
});

export async function savePoints(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await adminClient();
  if (!admin) return NOT_ADMIN;
  const parsed = schema.safeParse(formToObject(form));
  if (!parsed.success) return { error: firstIssue(parsed.error, { name: "Name", drop_worst_n: "Dropped races" }) };
  const table = parsePointsText(parsed.data.points);
  if (!table.ok) return { error: `Points: ${table.error}` };
  const { error } = await admin.supabase.rpc("admin_save_points_rules", {
    p_id: parsed.data.id || null,
    p_name: parsed.data.name,
    p_points: table.table,
    p_drop_worst_n: parsed.data.drop_worst_n,
  });
  if (error) return { error: adminErrorMessage(error.message) };
  // Saving rescores published results in the seasons that use the table.
  updateTag("results");
  revalidatePath("/admin/points");
  return { message: parsed.data.id ? "Saved. Results in seasons that use this table were rescored." : `Added ${parsed.data.name}. Choose it for a season on the Seasons page.` };
}
