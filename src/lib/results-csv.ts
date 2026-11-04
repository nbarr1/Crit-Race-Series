/**
 * Reads the officials' results sheet (CSV or tab-separated, as exported from
 * timing software or a spreadsheet). See DECISIONS.md D-104 for the columns
 * it recognizes. Pure functions, no I/O.
 */
import type { ResultStatus } from "@/lib/points";

export interface SheetRow {
  /** 1-based line number in the file, for error messages. */
  line: number;
  place: number | null;
  status: ResultStatus;
  bib: number | null;
  name: string;
  team: string;
  laps: number | null;
  /** Postgres interval text (HH:MM:SS or HH:MM:SS.s), or null. */
  finishTime: string | null;
}

export interface SheetIssue {
  line: number | null;
  message: string;
}

export interface ParsedSheet {
  rows: SheetRow[];
  /** Problems that block saving until the sheet is fixed. */
  errors: SheetIssue[];
  /** Things worth a look that don't block saving. */
  warnings: SheetIssue[];
}

export const MAX_SHEET_BYTES = 512 * 1024;
export const MAX_SHEET_ROWS = 500;

type Column = "place" | "bib" | "name" | "first" | "last" | "team" | "status" | "laps" | "time";

const HEADER_ALIASES: Record<Column, string[]> = {
  place: ["place", "pl", "plc", "pos", "position", "rank", "finish", "finish place", "overall", "result"],
  bib: ["bib", "bib number", "bib no", "number", "no", "num", "race number", "plate"],
  name: ["name", "rider", "rider name", "racer", "racer name", "full name", "athlete"],
  first: ["first", "first name", "firstname", "given name"],
  last: ["last", "last name", "lastname", "surname", "family name"],
  team: ["team", "club", "team name", "club team"],
  status: ["status", "result status", "state"],
  laps: ["laps", "lap", "laps completed"],
  time: ["time", "finish time", "elapsed", "elapsed time", "total time"],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[#.:_]/g, " ").replace(/\s+/g, " ").trim();
}

const STATUS_WORDS: Record<string, ResultStatus> = {
  "": "finished",
  fin: "finished",
  finished: "finished",
  ok: "finished",
  dnf: "DNF",
  otl: "DNF",
  lapped: "finished",
  dns: "DNS",
  dq: "DQ",
  dsq: "DQ",
  disqualified: "DQ",
};

/** Splits CSV text into records, handling quotes, doubled quotes, and CRLF. */
export function splitCsv(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field.trim() === "") {
      field = "";
      inQuotes = true;
    } else if (c === delimiter) {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  return records;
}

function detectDelimiter(firstLine: string): string {
  const counts = [",", "\t", ";"].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** "1:02:03", "62:03", "62:03.4", or "3723" (seconds) to an interval string. */
export function parseFinishTime(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(\.\d{1,3})?$/.exec(s) ?? /^(\d+)()()(\.\d{1,3})?$/.exec(s);
  if (!m) return null;
  let total: number;
  if (m[3] === "") total = Number(m[1]);
  else {
    const h = m[1] ? Number(m[1]) : 0;
    const min = Number(m[2]);
    const sec = Number(m[3]);
    if (sec >= 60 || (m[1] && min >= 60)) return null;
    total = h * 3600 + min * 60 + sec;
  }
  const frac = m[4] ?? "";
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(min)}:${pad(sec)}${frac}`;
}

function toInt(raw: string): number | null | "bad" {
  const s = raw.trim().replace(/(st|nd|rd|th)$/i, "");
  if (!s) return null;
  if (!/^\d+$/.test(s)) return "bad";
  const n = Number(s);
  return n > 0 && n <= 99999 ? n : "bad";
}

export function parseResultsSheet(text: string): ParsedSheet {
  const errors: SheetIssue[] = [];
  const warnings: SheetIssue[] = [];
  const rows: SheetRow[] = [];
  const clean = text.replace(/^﻿/, "");
  if (!clean.trim()) return { rows, errors: [{ line: null, message: "The sheet is empty." }], warnings };

  const firstLine = clean.split(/\r?\n/, 1)[0];
  const records = splitCsv(clean, detectDelimiter(firstLine));
  const headerIndex = records.findIndex((r) => r.some((c) => c.trim() !== ""));
  const header = records[headerIndex].map(normalizeHeader);

  const col: Partial<Record<Column, number>> = {};
  header.forEach((h, i) => {
    for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [Column, string[]][]) {
      if (col[key] === undefined && aliases.includes(h)) {
        col[key] = i;
        return;
      }
    }
  });

  if (col.name === undefined && col.last === undefined && col.bib === undefined) {
    errors.push({
      line: headerIndex + 1,
      message: "The first row needs column names, including a rider name (Name, or First and Last) or a Bib column.",
    });
    return { rows, errors, warnings };
  }
  if (col.place === undefined && col.status === undefined) {
    errors.push({ line: headerIndex + 1, message: "The sheet needs a Place column." });
    return { rows, errors, warnings };
  }

  const cell = (r: string[], k: Column) => (col[k] === undefined ? "" : (r[col[k]!] ?? "").trim());
  const dataRecords = records.slice(headerIndex + 1);
  if (dataRecords.length > MAX_SHEET_ROWS) {
    errors.push({ line: null, message: `The sheet has more than ${MAX_SHEET_ROWS} rows. Upload one category at a time.` });
    return { rows, errors, warnings };
  }

  dataRecords.forEach((r, i) => {
    const line = headerIndex + 2 + i;
    if (r.every((c) => c.trim() === "")) return;

    let status: ResultStatus = "finished";
    let place: number | null = null;
    const placeRaw = cell(r, "place");
    const placeWord = STATUS_WORDS[placeRaw.toLowerCase()];
    if (placeRaw && placeWord && placeWord !== "finished") status = placeWord;
    else {
      const p = toInt(placeRaw);
      if (p === "bad") {
        errors.push({ line, message: `Place "${placeRaw}" isn't a number or DNF, DNS, or DQ.` });
        return;
      }
      place = p;
    }
    const statusRaw = cell(r, "status");
    if (statusRaw) {
      const s = STATUS_WORDS[statusRaw.toLowerCase()];
      if (!s) {
        errors.push({ line, message: `Status "${statusRaw}" isn't one of finished, DNF, DNS, or DQ.` });
        return;
      }
      if (s !== "finished") status = s;
    }
    if (status !== "finished") place = null;
    if (status === "finished" && place == null) {
      errors.push({ line, message: "Each finisher needs a place. Mark riders who didn't finish as DNF, DNS, or DQ." });
      return;
    }

    const bibRaw = cell(r, "bib");
    const bib = toInt(bibRaw.replace(/^#/, ""));
    if (bib === "bad") {
      errors.push({ line, message: `Bib "${bibRaw}" isn't a number.` });
      return;
    }
    const name = (
      col.name !== undefined ? cell(r, "name") : `${cell(r, "first")} ${cell(r, "last")}`
    ).replace(/\s+/g, " ").trim().slice(0, 200);
    if (!name && bib == null) {
      errors.push({ line, message: "Each row needs a rider name or a bib." });
      return;
    }
    const lapsRaw = cell(r, "laps");
    const laps = lapsRaw && /^\d{1,4}$/.test(lapsRaw) ? Number(lapsRaw) : null;
    if (lapsRaw && laps == null) warnings.push({ line, message: `Laps "${lapsRaw}" was ignored.` });
    const timeRaw = cell(r, "time");
    const finishTime = parseFinishTime(timeRaw);
    if (timeRaw && !finishTime && !/^[+-]|lap/i.test(timeRaw)) warnings.push({ line, message: `Time "${timeRaw}" was ignored.` });

    rows.push({ line, place, status, bib, name, team: cell(r, "team").slice(0, 200), laps, finishTime });
  });

  if (!rows.length && !errors.length) errors.push({ line: null, message: "The sheet has no result rows." });

  const seenPlace = new Map<number, number>();
  const seenBib = new Map<number, number>();
  for (const r of rows) {
    if (r.place != null) {
      const prev = seenPlace.get(r.place);
      if (prev) errors.push({ line: r.line, message: `Place ${r.place} is also on line ${prev}.` });
      else seenPlace.set(r.place, r.line);
    }
    if (r.bib != null) {
      const prev = seenBib.get(r.bib);
      if (prev) errors.push({ line: r.line, message: `Bib ${r.bib} is also on line ${prev}.` });
      else seenBib.set(r.bib, r.line);
    }
  }
  const places = [...seenPlace.keys()].sort((a, b) => a - b);
  const missing = places.length ? Array.from({ length: places[places.length - 1] }, (_, i) => i + 1).filter((p) => !seenPlace.has(p)) : [];
  if (missing.length) {
    warnings.push({
      line: null,
      message: `No rider is listed in ${missing.length === 1 ? "place" : "places"} ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", and more" : ""}.`,
    });
  }
  return { rows, errors, warnings };
}
