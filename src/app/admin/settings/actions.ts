"use server";

import { revalidatePath, updateTag } from "next/cache";
import { adminClient, NOT_ADMIN } from "@/lib/admin/server";
import { adminErrorMessage, type AdminState } from "@/lib/admin/errors";
import { getSettingsAdmin } from "@/lib/admin/data";
import { readSetting, SETTING_LABELS, settingKind } from "@/lib/admin/settings-form";

export async function saveSettings(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await adminClient();
  if (!admin) return NOT_ADMIN;
  const current = await getSettingsAdmin(admin.supabase);
  const values: Record<string, unknown> = {};
  for (const [key, old] of Object.entries(current)) {
    // Only settings the form showed; a setting added since the page loaded is left alone.
    if (!form.has(`shown:${key}`)) continue;
    const raw = form.get(`s:${key}`);
    const read = readSetting(settingKind(key, old), typeof raw === "string" ? raw : null);
    if (!read.ok) return { error: `${SETTING_LABELS[key] ?? key}: ${read.error}` };
    values[key] = read.value;
  }
  const { data, error } = await admin.supabase.rpc("admin_save_settings", { p_values: values });
  if (error) return { error: adminErrorMessage(error.message) };
  updateTag("settings");
  revalidatePath("/admin/settings");
  const n = Number(data ?? 0);
  return { message: n === 0 ? "No changes to save." : `Saved ${n} ${n === 1 ? "setting" : "settings"}.` };
}
