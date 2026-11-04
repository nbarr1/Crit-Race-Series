"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminClient, NOT_ADMIN } from "@/lib/admin/server";
import { adminErrorMessage, type AdminState } from "@/lib/admin/errors";

const schema = z.object({ id: z.uuid(), role: z.enum(["rider", "staff", "admin"]), name: z.string().max(200).default("") });

export async function setRole(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await adminClient();
  if (!admin) return NOT_ADMIN;
  const parsed = schema.safeParse({ id: form.get("id"), role: form.get("role"), name: form.get("name") ?? "" });
  if (!parsed.success) return { error: "Choose a role." };
  const { error } = await admin.supabase.rpc("admin_set_role", { target_profile_id: parsed.data.id, new_role: parsed.data.role });
  if (error) return { error: adminErrorMessage(error.message) };
  revalidatePath("/admin/people");
  const who = parsed.data.name || "They";
  const what = { rider: "a rider (no staff tools)", staff: "staff", admin: "an admin" }[parsed.data.role];
  return { message: `${who} is now ${what}. The change applies the next time they load a page.` };
}
