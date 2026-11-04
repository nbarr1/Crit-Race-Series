// Pure parsing for app_settings rows, shared by the server and tests.

export type PublicSettings = {
  paymentsEnabled: boolean;
  refundPolicy: "no_automatic_refunds" | "full_refund_before_close";
  minorsAllowed: boolean;
  usacLicenseRequired: boolean;
  waitlistOfferHours: number;
  externalWaiverUrl: string | null;
};

export const DEFAULT_SETTINGS: PublicSettings = {
  paymentsEnabled: true,
  refundPolicy: "no_automatic_refunds",
  minorsAllowed: true,
  usacLicenseRequired: false,
  waitlistOfferHours: 24,
  externalWaiverUrl: null,
};

export function parseSettings(rows: { key: string; value: unknown }[]): PublicSettings {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const bool = (k: string, d: boolean) => (typeof map.get(k) === "boolean" ? (map.get(k) as boolean) : d);
  const num = (k: string, d: number) => (typeof map.get(k) === "number" ? (map.get(k) as number) : d);
  const refund = map.get("refund_policy");
  const ext = map.get("external_waiver_url");
  return {
    paymentsEnabled: bool("payments_enabled", DEFAULT_SETTINGS.paymentsEnabled),
    refundPolicy: refund === "full_refund_before_close" ? "full_refund_before_close" : "no_automatic_refunds",
    minorsAllowed: bool("minors_allowed", DEFAULT_SETTINGS.minorsAllowed),
    usacLicenseRequired: bool("usac_license_required", DEFAULT_SETTINGS.usacLicenseRequired),
    waitlistOfferHours: num("waitlist_offer_hours", DEFAULT_SETTINGS.waitlistOfferHours),
    externalWaiverUrl: typeof ext === "string" && ext ? ext : null,
  };
}
