/**
 * Points tables are edited as a list of numbers, one per place, starting at
 * first place: "25, 20, 16". These helpers convert to and from the stored
 * {"1": 25, "2": 20, ...} object.
 */
export function pointsToText(table: Record<string, unknown>): string {
  const places = Object.keys(table)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
  const max = places.at(-1) ?? 0;
  return Array.from({ length: max }, (_, i) => String(Number(table[String(i + 1)] ?? 0))).join(", ");
}

export function parsePointsText(text: string): { ok: true; table: Record<string, number> } | { ok: false; error: string } {
  const parts = text
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { ok: false, error: "Enter the points for at least first place." };
  if (parts.length > 200) return { ok: false, error: "Enter points for up to 200 places." };
  const table: Record<string, number> = {};
  for (const [i, p] of parts.entries()) {
    if (!/^\d{1,4}$/.test(p) || Number(p) > 1000) {
      return { ok: false, error: `Place ${i + 1}: "${p}" isn't a whole number from 0 to 1000.` };
    }
    table[String(i + 1)] = Number(p);
  }
  return { ok: true, table };
}
