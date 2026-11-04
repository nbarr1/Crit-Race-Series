/**
 * CSV writing for exports. Values that a spreadsheet would treat as a formula
 * (=, +, -, @, tab, carriage return) get a leading apostrophe, which blocks
 * CSV formula injection from rider-entered text.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function csvResponseHeaders(filename: string): HeadersInit {
  return {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
    "cache-control": "no-store",
  };
}
