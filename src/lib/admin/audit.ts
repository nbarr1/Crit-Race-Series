/** Fields that differ between an audit row's before and after values. */
export function changedFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  keys.delete("updated_at");
  return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
}

/** A short, human label for an audit row's table. */
export const TABLE_LABELS: Record<string, string> = {
  registrations: "Registration",
  results: "Result",
  profiles: "Person",
  events: "Event",
  event_categories: "Event category",
  app_settings: "Setting",
  waiver_versions: "Waiver version",
  waiver_signatures: "Waiver signature",
  season_passes: "Season pass",
  announcements: "Announcement",
  seasons: "Season",
  points_rules: "Points table",
  categories: "Category",
  sponsors: "Sponsor",
  venues: "Venue",
};
