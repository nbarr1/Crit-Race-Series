/**
 * Matches rows from a results sheet to riders registered for the event
 * (DECISIONS.md D-105). Bib first, because bibs are unique per event (D-012).
 * Then the name, preferring riders registered in the category being scored.
 * Pure functions, no I/O.
 */
import type { SheetRow } from "@/lib/results-csv";

export interface EventEntrant {
  riderId: string;
  eventCategoryId: string;
  categoryName: string;
  bib: number | null;
  firstName: string;
  lastName: string;
  displayName: string;
  team: string | null;
}

export type MatchMethod = "bib" | "name" | "none";

export interface MatchedRow extends SheetRow {
  riderId: string | null;
  method: MatchMethod;
  notes: string[];
}

/** Lowercase, no accents, no punctuation, single spaces. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Name forms a sheet might use for this rider: "first last", "last first", and the display name. */
function nameKeys(e: EventEntrant): string[] {
  const first = normalizeName(e.firstName);
  const last = normalizeName(e.lastName);
  return [...new Set([`${first} ${last}`, `${last} ${first}`, normalizeName(e.displayName)].map((k) => k.replace(/,/g, "").trim()).filter(Boolean))];
}

/** "Ortiz, Rita" becomes "rita ortiz". */
function sheetNameKey(raw: string): string {
  const n = normalizeName(raw);
  const comma = n.indexOf(",");
  if (comma > 0) return `${n.slice(comma + 1).trim()} ${n.slice(0, comma).trim()}`.replace(/,/g, "").trim();
  return n.replace(/,/g, "").trim();
}

export function entrantLabel(e: EventEntrant): string {
  const name = `${e.firstName} ${e.lastName}`.trim() || e.displayName;
  return `${name}${e.bib != null ? ` (bib ${e.bib})` : ""}`;
}

export function matchResults(rows: SheetRow[], entrants: EventEntrant[], eventCategoryId: string): MatchedRow[] {
  const byBib = new Map<number, EventEntrant>();
  for (const e of entrants) if (e.bib != null) byBib.set(e.bib, e);
  const byName = new Map<string, EventEntrant[]>();
  for (const e of entrants) {
    for (const k of nameKeys(e)) {
      const list = byName.get(k) ?? [];
      if (!list.some((x) => x.riderId === e.riderId)) list.push(e);
      byName.set(k, list);
    }
  }

  const matched: MatchedRow[] = rows.map((row) => {
    const notes: string[] = [];
    const key = row.name ? sheetNameKey(row.name) : "";

    if (row.bib != null) {
      const e = byBib.get(row.bib);
      if (e) {
        if (key && !nameKeys(e).includes(key)) notes.push(`Bib ${row.bib} belongs to ${entrantLabel(e)}, but the sheet says "${row.name}".`);
        if (e.eventCategoryId !== eventCategoryId) notes.push(`${entrantLabel(e)} is registered in ${e.categoryName}.`);
        return { ...row, riderId: e.riderId, method: "bib", notes };
      }
      notes.push(`No rider at this event has bib ${row.bib}.`);
    }

    if (key) {
      const candidates = byName.get(key) ?? [];
      const inCategory = candidates.filter((c) => c.eventCategoryId === eventCategoryId);
      const pick = inCategory.length ? inCategory : candidates;
      const unique = [...new Map(pick.map((c) => [c.riderId, c])).values()];
      if (unique.length === 1) {
        const e = unique[0];
        if (e.eventCategoryId !== eventCategoryId) notes.push(`${entrantLabel(e)} is registered in ${e.categoryName}.`);
        return { ...row, riderId: e.riderId, method: "name", notes };
      }
      if (unique.length > 1) notes.push(`More than one rider is named "${row.name}". Choose one.`);
      else notes.push(`No registered rider is named "${row.name}".`);
    }
    return { ...row, riderId: null, method: "none", notes };
  });

  return flagDuplicateRiders(matched);
}

/**
 * A rider can have one result per category. If two rows matched the same
 * rider, the second loses its match and both get a note.
 */
export function flagDuplicateRiders(rows: MatchedRow[]): MatchedRow[] {
  const firstLine = new Map<string, number>();
  return rows.map((r) => {
    if (!r.riderId) return r;
    const prev = firstLine.get(r.riderId);
    if (prev === undefined) {
      firstLine.set(r.riderId, r.line);
      return r;
    }
    return { ...r, riderId: null, method: "none" as const, notes: [...r.notes, `This rider is already matched on line ${prev}.`] };
  });
}
