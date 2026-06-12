import type { ReactNode } from "react";

// Renders the constrained markdown subset the Ask AI prompt permits (paragraphs,
// "- " bullets, numbered lists, ### headings, **bold**/*italic*) straight to React
// elements — no dangerouslySetInnerHTML (project hard rule), no parser dependency.

function inline(text: string): ReactNode[] {
  // Split on **bold** and *italic* spans; everything else passes through as text.
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return tokens.map((t, i) => {
    if (t.startsWith("**") && t.endsWith("**") && t.length > 4)
      return <strong key={i}>{t.slice(2, -2)}</strong>;
    if (t.startsWith("*") && t.endsWith("*") && t.length > 2)
      return <em key={i}>{t.slice(1, -1)}</em>;
    return t;
  });
}

export function renderMarkdown(text: string): ReactNode {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = (key: number) => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{inline(item)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={`l${key}`} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={`l${key}`} className="list-disc space-y-1 pl-5">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    const bullet = line.match(/^[-*]\s+(.*)/);
    const numbered = line.match(/^\d+[.)]\s+(.*)/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList(i);
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
      return;
    }
    flushList(i);
    if (!line) return;
    const heading = line.match(/^#{1,4}\s+(.*)/);
    if (heading) {
      blocks.push(
        <h3 key={i} className="pt-1 text-sm font-semibold text-ink">
          {inline(heading[1])}
        </h3>,
      );
      return;
    }
    blocks.push(<p key={i}>{inline(line)}</p>);
  });
  flushList(lines.length);

  return <div className="space-y-2 text-sm leading-relaxed text-ink">{blocks}</div>;
}
