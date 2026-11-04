// How each app setting appears on the admin settings screen, and how a
// submitted form value turns back into the JSON stored in app_settings.

export type SettingKind = "boolean" | "integer" | "money" | "text" | "url" | "refund_policy";

export const SETTING_LABELS: Record<string, string> = {
  payments_enabled: "Take online payments through Stripe",
  refund_policy: "Refund policy",
  usac_license_required: "Require a USA Cycling license number",
  minors_allowed: "Allow riders under 18 (with a guardian's signature)",
  waitlist_offer_hours: "Hours a rider promoted from the waitlist has to pay",
  default_category_capacity: "Default capacity for a new category",
  default_price_cents: "Default online price for a new category ($)",
  default_walk_up_price_cents: "Default walk-up price for a new category ($)",
  season_pass_price_cents: "Default season pass price for a new season ($)",
  external_waiver_url: "External waiver link",
  schedule_cadence_note: "Schedule note",
  reminder_hours_before: "Race-day reminder, hours before the first start",
};

/** Settings listed first, in this order. Anything else follows by key. */
export const SETTING_ORDER = Object.keys(SETTING_LABELS);

export function settingKind(key: string, value: unknown): SettingKind {
  if (key === "refund_policy") return "refund_policy";
  if (key.endsWith("_cents")) return "money";
  if (key.endsWith("_url")) return "url";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "integer";
  return "text";
}

/**
 * Reads one setting from the form. Checkboxes send nothing when unchecked,
 * so a missing boolean is false. Returns an error sentence for bad input.
 */
export function readSetting(
  kind: SettingKind,
  raw: string | null,
): { ok: true; value: boolean | number | string | null } | { ok: false; error: string } {
  const s = (raw ?? "").trim();
  switch (kind) {
    case "boolean":
      return { ok: true, value: raw === "on" };
    case "integer":
      if (!/^\d{1,6}$/.test(s)) return { ok: false, error: "Enter a whole number, 0 or more." };
      return { ok: true, value: Number(s) };
    case "money": {
      const m = /^\$?(\d{1,5})(?:\.(\d{1,2}))?$/.exec(s.replace(/,/g, ""));
      if (!m) return { ok: false, error: "Enter an amount in dollars, such as 25 or 25.50." };
      return { ok: true, value: Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) };
    }
    case "url":
      if (s === "") return { ok: true, value: null };
      if (!/^https:\/\/\S+$/.test(s) || s.length > 500) return { ok: false, error: "Use a full https:// link, or leave it blank." };
      return { ok: true, value: s };
    case "refund_policy":
      if (s !== "no_automatic_refunds" && s !== "full_refund_before_close") return { ok: false, error: "Choose a refund policy." };
      return { ok: true, value: s };
    case "text":
      if (s.length > 500) return { ok: false, error: "Keep it under 500 characters." };
      return { ok: true, value: s };
  }
}
