import type { z } from "zod";

/** What an admin form shows after a submit. */
export type AdminState = { error?: string; message?: string; savedId?: string };

// Error codes raised by the admin database functions
// (supabase/migrations/20261109000100_admin.sql).
const MESSAGES: Record<string, string> = {
  admin_only: "Only admins can make this change.",
  not_found: "That item wasn't found. It may have been deleted. Reload the page.",
  name_required: "Enter a name.",
  year_invalid: "Enter a year between 2000 and 2100.",
  price_invalid: "Prices can't be negative.",
  points_rules_not_found: "That points table wasn't found.",
  date_required: "Pick a date.",
  registration_window: "Registration has to close after it opens.",
  categories_invalid: "The categories couldn't be read. Reload the page and try again.",
  no_categories: "Add at least one category before publishing the event.",
  duplicate_category: "Each category can appear only once in an event.",
  category_in_use: "Riders have registered for a category you removed or changed, so it has to stay. Set its capacity to 0 to close it instead.",
  category_times: "Each category needs a start time and a length.",
  value_out_of_range: "One of the numbers is out of range.",
  event_in_use: "Riders have registered for this event or it has results, so it can't be deleted. Change its status to canceled instead.",
  duplicate_name: "Another category already has that name.",
  points_invalid: "Enter whole-number points, from 0 to 1000, for places starting at 1.",
  coordinates_invalid: "Latitude must be between -90 and 90, and longitude between -180 and 180.",
  url_invalid: "Use a full https:// link.",
  settings_invalid: "The settings couldn't be read. Reload the page and try again.",
  unknown_setting: "One of the settings no longer exists. Reload the page.",
  setting_type: "One of the settings has a value of the wrong kind.",
  admins_cannot_remove: "You can't remove your own admin role. Ask another admin to do it.",
};

/** Turns a database error into a sentence for the admin. */
export function adminErrorMessage(message: string | undefined, fallback = "That didn't save. Try again."): string {
  if (!message) return fallback;
  if (message.includes("cannot remove their own admin role")) return MESSAGES.admins_cannot_remove;
  if (message.includes("only admins")) return MESSAGES.admin_only;
  for (const [code, text] of Object.entries(MESSAGES)) if (message.includes(code)) return text;
  return fallback;
}

/** The first problem in a Zod error, as one sentence with the field's label. */
export function firstIssue(error: z.ZodError, labels: Record<string, string> = {}): string {
  const issue = error.issues[0];
  if (!issue) return "Check the form and try again.";
  const key = String(issue.path[0] ?? "");
  const label = labels[key];
  return label ? `${label}: ${issue.message}` : issue.message;
}
