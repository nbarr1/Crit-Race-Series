import { randomUUID } from "node:crypto";

/**
 * What staff may upload to the public media bucket, by purpose. Uploads go
 * through a server action, and Vercel caps request bodies at 4.5 MB, so files
 * are limited to 4 MB (D-094).
 */
const RULES = {
  course_map: { types: { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" }, maxBytes: 4 * 1024 * 1024 },
  gpx: { types: { "application/gpx+xml": "gpx", "application/octet-stream": "gpx", "text/xml": "gpx", "application/xml": "gpx" }, maxBytes: 4 * 1024 * 1024 },
  logo: { types: { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" }, maxBytes: 2 * 1024 * 1024 },
} as const;

export type UploadKind = keyof typeof RULES;

export type CheckedUpload = { ok: true; path: string; contentType: string } | { ok: false; error: string };

/**
 * Validates an uploaded file and picks a storage path with a random name, so
 * an uploaded file name never becomes part of a URL.
 */
export function checkUpload(file: File | null, kind: UploadKind, folder: string): CheckedUpload {
  if (!file || file.size === 0) return { ok: false, error: "Choose a file." };
  const rule = RULES[kind];
  if (file.size > rule.maxBytes) return { ok: false, error: `The file is too large. The limit is ${rule.maxBytes / 1024 / 1024} MB.` };
  const lower = file.name.toLowerCase();
  if (kind === "gpx" && !lower.endsWith(".gpx")) return { ok: false, error: "Choose a .gpx file." };
  const ext = (rule.types as Record<string, string>)[file.type];
  if (!ext) {
    const allowed = [...new Set(Object.values(rule.types))].join(", ");
    return { ok: false, error: `That file type isn't allowed. Use ${allowed}.` };
  }
  const contentType = kind === "gpx" ? "application/gpx+xml" : file.type;
  return { ok: true, path: `${folder}/${randomUUID()}.${ext}`, contentType };
}
