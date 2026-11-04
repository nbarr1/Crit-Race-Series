import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { markdownToBlocks, wrapText } from "@/lib/markdown-text";
import { formatDateTime } from "@/lib/time";

export type WaiverPdfInput = {
  seriesName: string;
  waiverTitle: string;
  versionNumber: number;
  bodyMarkdown: string;
  riderName: string;
  riderBirthDate: string | null;
  typedFullName: string;
  signedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  signatureId: string;
  guardian?: { name: string; relationship: string; typedSignature: string } | null;
  collectedBy?: string | null;
};

// The standard PDF fonts only cover WinAnsi. Replace characters they can't
// draw instead of failing the whole PDF.
function safe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF•]/g, "?");
}

export async function buildWaiverPdf(input: WaiverPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.waiverTitle} - ${input.riderName}`);
  doc.setSubject(`Signed waiver, version ${input.versionNumber}`);
  doc.setProducer(input.seriesName);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const margin = 54;
  const pageWidth = 612;
  const pageHeight = 792;
  const maxWidth = pageWidth - margin * 2;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const write = (text: string, opts: { font?: PDFFont; size?: number; indent?: number; gap?: number } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10.5;
    const indent = opts.indent ?? 0;
    const lineHeight = size * 1.35;
    for (const line of wrapText(safe(text), maxWidth - indent, (s) => font.widthOfTextAtSize(s, size))) {
      if (y - lineHeight < margin) {
        page = doc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawText(line, { x: margin + indent, y: y - size, size, font, color: rgb(0.06, 0.09, 0.16) });
      y -= lineHeight;
    }
    y -= opts.gap ?? 6;
  };

  write(input.seriesName, { font: bold, size: 9, gap: 2 });
  write(input.waiverTitle, { font: bold, size: 15, gap: 2 });
  write(`Version ${input.versionNumber}`, { size: 9, gap: 12 });

  for (const block of markdownToBlocks(input.bodyMarkdown)) {
    if (block.kind === "heading") write(block.text, { font: bold, size: 12 });
    else if (block.kind === "item") write(`${block.marker} ${block.text}`, { indent: 12 });
    else write(block.text);
  }

  y -= 10;
  write("Signature", { font: bold, size: 12 });
  const rows: [string, string][] = [
    ["Rider", input.riderName],
    ["Birth date", input.riderBirthDate ?? "Not given"],
    ["Typed signature", input.typedFullName],
    ["Agreed", "Yes. The rider checked \"I have read and agree to this waiver.\""],
    ["Signed", `${formatDateTime(input.signedAt)} Eastern Time (${input.signedAt} UTC)`],
    ["IP address", input.ipAddress ?? "Not recorded"],
    ["Device", input.userAgent ?? "Not recorded"],
  ];
  if (input.guardian) {
    rows.push(
      ["Parent or guardian", input.guardian.name],
      ["Relationship", input.guardian.relationship],
      ["Guardian signature", input.guardian.typedSignature],
    );
  }
  if (input.collectedBy) rows.push(["Collected on a staff device by", input.collectedBy]);
  rows.push(["Signature ID", input.signatureId]);
  for (const [label, value] of rows) write(`${label}: ${value}`, { gap: 2 });

  return doc.save();
}
