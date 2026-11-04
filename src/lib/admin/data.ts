import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SettingRow = { key: string; value: unknown; description: string };

/** Every app setting as a key-to-value map, read with the admin's session. */
export async function getSettingsAdmin(supabase: SupabaseClient): Promise<Record<string, unknown>> {
  const { data } = await supabase.from("app_settings").select("key, value");
  return Object.fromEntries(((data ?? []) as SettingRow[]).map((r) => [r.key, r.value]));
}

export type AdminSeason = { id: string; name: string; year: number; is_active: boolean };

/** The season named in ?season=, or the active one, plus the full list. */
export async function pickSeason(supabase: SupabaseClient, requested: string | undefined) {
  const { data } = await supabase.from("seasons").select("id, name, year, is_active").order("year", { ascending: false });
  const seasons = (data ?? []) as AdminSeason[];
  const season = seasons.find((s) => s.id === requested) ?? seasons.find((s) => s.is_active) ?? seasons[0] ?? null;
  return { seasons, season };
}

export type DashboardEvent = {
  id: string;
  name: string;
  event_date: string;
  status: "draft" | "published" | "canceled" | "completed";
  capacity: number;
  categories: number;
  confirmed: number;
  pending_payment: number;
  waitlisted: number;
  checked_in: number;
  revenue_cents: number;
};

export type Dashboard = {
  events: DashboardEvent[];
  riders: number;
  waiver_version: number | null;
  waiver_signers: number;
  season_passes: number;
  season_pass_revenue_cents: number;
  staff: number;
  unconfirmed_venues: number;
  placeholder_prices: number;
};

export async function getDashboard(supabase: SupabaseClient, seasonId: string): Promise<Dashboard | null> {
  const { data, error } = await supabase.rpc("admin_dashboard", { p_season_id: seasonId });
  if (error) {
    console.error("admin_dashboard failed", error.message);
    return null;
  }
  return data as Dashboard;
}

/** Choices every event form needs: seasons, venues, and categories. */
export async function getEventFormOptions(supabase: SupabaseClient) {
  const [{ data: seasons }, { data: venues }, { data: categories }, settings] = await Promise.all([
    supabase.from("seasons").select("id, name").order("year", { ascending: false }),
    supabase.from("venues").select("id, name").order("name"),
    supabase.from("categories").select("id, name, sort_order").order("sort_order"),
    getSettingsAdmin(supabase),
  ]);
  const num = (k: string, d: number) => (typeof settings[k] === "number" ? (settings[k] as number) : d);
  return {
    seasons: (seasons ?? []) as { id: string; name: string }[],
    venues: (venues ?? []) as { id: string; name: string }[],
    categories: (categories ?? []) as { id: string; name: string; sort_order: number }[],
    defaults: {
      capacity: num("default_category_capacity", 60),
      priceCents: num("default_price_cents", 2500),
      walkUpPriceCents: num("default_walk_up_price_cents", 3000),
    },
  };
}
