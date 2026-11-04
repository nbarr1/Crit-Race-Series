import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/env";

export { parseSettings, DEFAULT_SETTINGS, type PublicSettings } from "@/lib/settings-parse";
import { parseSettings, DEFAULT_SETTINGS, type PublicSettings } from "@/lib/settings-parse";

export async function getSettings(): Promise<PublicSettings> {
  "use cache";
  cacheLife("minutes");
  cacheTag("settings");
  if (!isSupabaseConfigured()) return DEFAULT_SETTINGS;
  const { data } = await createPublicClient().from("app_settings").select("key, value");
  return parseSettings((data ?? []) as { key: string; value: unknown }[]);
}
