import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type StartListEntry = { bib: number | null; name: string; team: string; license: string; checkedIn: boolean };
export type StartListSection = { category: string; startTime: string; entries: StartListEntry[] };

const clean = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

/** One page or more per category, for the officials' clipboard. */
export async function buildStartListPdf(title: string, subtitle: string, sections: StartListSection[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${title} start list`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 40;
  const cols = [
    { label: "Bib", x: M, w: 44 },
    { label: "Rider", x: M + 50, w: 190 },
    { label: "Team", x: M + 246, w: 160 },
    { label: "License", x: M + 412, w: 80 },
    { label: "In", x: M + 500, w: 30 },
  ];
  const fit = (text: string, w: number, size: number) => {
    let t = clean(text);
    while (t && font.widthOfTextAtSize(t, size) > w) t = t.slice(0, -1);
    return t.length < clean(text).length ? `${t.slice(0, -1)}.` : t;
  };

  for (const section of sections) {
    let page = doc.addPage([W, H]);
    let y = H - M;
    const header = (continued: boolean) => {
      page.drawText(clean(`${title} - ${section.category}${continued ? " (continued)" : ""}`), { x: M, y: y - 16, size: 16, font: bold });
      y -= 22;
      page.drawText(clean(`${subtitle} · Start ${section.startTime} · ${section.entries.length} riders`), { x: M, y: y - 10, size: 10, font });
      y -= 24;
      for (const c of cols) page.drawText(c.label, { x: c.x, y: y - 10, size: 10, font: bold });
      y -= 14;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: rgb(0, 0, 0) });
      y -= 4;
    };
    header(false);
    section.entries.forEach((e, i) => {
      if (y < M + 20) {
        page = doc.addPage([W, H]);
        y = H - M;
        header(true);
      }
      if (i % 2 === 0) page.drawRectangle({ x: M - 2, y: y - 15, width: W - 2 * M + 4, height: 17, color: rgb(0.93, 0.95, 0.97) });
      const cells = [e.bib != null ? String(e.bib) : "-", e.name, e.team, e.license, e.checkedIn ? "Yes" : ""];
      cells.forEach((text, ci) => page.drawText(fit(text, cols[ci].w, 11), { x: cols[ci].x, y: y - 11, size: 11, font: ci === 0 ? bold : font }));
      y -= 17;
    });
  }
  if (sections.length === 0) doc.addPage([W, H]).drawText("No riders.", { x: M, y: H - M - 16, size: 14, font });
  return doc.save();
}
