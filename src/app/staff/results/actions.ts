"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MAX_SHEET_BYTES, parseResultsSheet, type SheetIssue } from "@/lib/results-csv";
import { matchResults, type MatchedRow } from "@/lib/results-match";
import { loadEntrants, loadEventCategory } from "@/lib/results-staff";

export type PreviewState = {
  error?: string;
  errors?: SheetIssue[];
  warnings?: SheetIssue[];
  rows?: MatchedRow[];
  /** Bumps on each successful preview so the client resets its edits. */
  version?: number;
};

export type SaveState = { error?: string; message?: string };

async function staffClient() {
  const p = await getCurrentProfile();
  return p?.role === "staff" || p?.role === "admin" ? createClient() : null;
}

const id = z.uuid();

/** Reads the uploaded file or pasted text, then parses and matches it. Nothing is saved. */
export async function previewResults(prev: PreviewState, form: FormData): Promise<PreviewState> {
  const supabase = await staffClient();
  const ecId = id.safeParse(form.get("event_category_id"));
  if (!supabase || !ecId.success) return { error: "Only race staff can upload results." };
  const ec = await loadEventCategory(supabase, ecId.data);
  if (!ec) return { error: "That race wasn't found." };

  const file = form.get("file");
  let text = String(form.get("pasted") ?? "");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_SHEET_BYTES) return { error: "That file is larger than 512 KB. Upload one category at a time." };
    text = await file.text();
  }
  if (text.length > MAX_SHEET_BYTES) return { error: "That sheet is larger than 512 KB. Upload one category at a time." };
  if (!text.trim()) return { error: "Choose a CSV file, or paste the results." };

  const sheet = parseResultsSheet(text);
  if (sheet.errors.length) return { errors: sheet.errors, warnings: sheet.warnings };
  const entrants = await loadEntrants(supabase, ec.event_id);
  return {
    rows: matchResults(sheet.rows, entrants, ec.id),
    warnings: sheet.warnings,
    version: (prev.version ?? 0) + 1,
  };
}

const rowSchema = z.object({
  place: z.number().int().positive().nullable(),
  status: z.enum(["finished", "DNF", "DNS", "DQ"]),
  bib: z.number().int().positive().max(99999).nullable(),
  name: z.string().max(200),
  laps: z.number().int().min(0).max(9999).nullable(),
  finishTime: z.string().regex(/^\d{2,}:\d{2}:\d{2}(\.\d{1,3})?$/).nullable(),
  riderId: z.uuid().nullable(),
});
const rowsSchema = z.array(rowSchema).min(1).max(500);

const SAVE_ERRORS: Record<string, string> = {
  duplicate_place: "Two rows have the same place.",
  duplicate_rider: "The same rider is matched to two rows. Change one of them.",
  place_required: "Each finisher needs a place.",
  name_required: "Each unmatched row needs a name.",
  rider_not_found: "One of the matched riders no longer exists. Preview the sheet again.",
  staff_only: "Only race staff can save results.",
  not_found: "That race wasn't found.",
};

function saveErrorMessage(message: string | undefined): string {
  for (const [code, text] of Object.entries(SAVE_ERRORS)) if (message?.includes(code)) return text;
  return "The results didn't save. Try again.";
}

/** Saves the previewed rows (with any rider changes) as a draft, replacing the category's results. */
export async function saveResults(_prev: SaveState, form: FormData): Promise<SaveState> {
  const supabase = await staffClient();
  const ecId = id.safeParse(form.get("event_category_id"));
  if (!supabase || !ecId.success) return { error: "Only race staff can save results." };
  let parsed: z.infer<typeof rowsSchema>;
  try {
    const r = rowsSchema.safeParse(JSON.parse(String(form.get("rows") ?? "[]")));
    if (!r.success) return { error: "The results couldn't be read. Preview the sheet again." };
    parsed = r.data;
  } catch {
    return { error: "The results couldn't be read. Preview the sheet again." };
  }
  const { error } = await supabase.rpc("save_results", {
    p_event_category_id: ecId.data,
    p_sheet: {
      rows: parsed.map((r) => ({
        place: r.place,
        status: r.status,
        bib: r.bib,
        raw_name: r.name,
        rider_id: r.riderId,
        laps: r.laps,
        finish_time: r.finishTime,
      })),
    },
  });
  if (error) {
    console.error("save_results failed", error.message);
    return { error: saveErrorMessage(error.message) };
  }
  // Saving replaces published rows with a draft, so public pages change too.
  updateTag("results");
  revalidatePath(`/staff/results/${ecId.data}`);
  return { message: `Saved ${parsed.length} results as a draft. Publish them when they're checked.` };
}

export async function setPublished(form: FormData): Promise<void> {
  const supabase = await staffClient();
  const ecId = id.safeParse(form.get("event_category_id"));
  if (!supabase || !ecId.success) return;
  const publish = form.get("publish") === "true";
  const { error } = await supabase.rpc("publish_results", { p_event_category_id: ecId.data, p_publish: publish });
  if (error) console.error("publish_results failed", error.message);
  updateTag("results");
  revalidatePath(`/staff/results/${ecId.data}`);
  revalidatePath("/staff/results");
}
