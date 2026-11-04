/**
 * Converts the small Markdown subset used in waivers (headings, paragraphs,
 * numbered and bulleted lists, bold and italic, links) to plain paragraphs for
 * the PDF copy. The web page renders the Markdown itself with react-markdown.
 */
export type TextBlock = { kind: "heading" | "paragraph" | "item"; text: string; marker?: string };

function inline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function markdownToBlocks(md: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "paragraph", text: inline(para.join(" ")) });
    para = [];
  };
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line);
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", text: inline(heading[1]) });
    } else if (numbered) {
      flush();
      blocks.push({ kind: "item", marker: `${numbered[1]}.`, text: inline(numbered[2]) });
    } else if (bullet) {
      flush();
      blocks.push({ kind: "item", marker: "•", text: inline(bullet[1]) });
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

/** Greedy word wrap by a width function (font metrics in the PDF). */
export function wrapText(text: string, maxWidth: number, width: (s: string) => number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (width(candidate) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
