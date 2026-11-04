import Markdown from "react-markdown";

/** Renders waiver Markdown. react-markdown ignores raw HTML, so admin-entered text can't inject markup. */
export function WaiverText({ markdown }: { markdown: string }) {
  return (
    <div className="space-y-3 rounded-lg border-2 border-border bg-muted/40 p-4 text-base leading-relaxed [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold [&_li]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_strong]:font-bold [&_ul]:list-disc [&_a]:text-primary [&_a]:underline">
      <Markdown>{markdown}</Markdown>
    </div>
  );
}
