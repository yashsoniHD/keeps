import type { ReactNode } from "react";

// Renders the constrained markdown subset the Ask AI prompt permits (paragraphs,
// "- " bullets, numbered lists, ### headings, **bold**/*italic*) straight to React
// elements — no dangerouslySetInnerHTML (project hard rule), no parser dependency.

// Options let a caller (Ask AI) turn note-id links into tappable in-app navigation.
export type MarkdownOpts = { onNoteClick?: (noteId: string) => void };

// Any [label](target) with no whitespace in the target. We split on the generic form and
// then classify the target: http(s) → external anchor; a bare note id → in-app link; anything
// else (e.g. a model-emitted javascript:/data: URI) → the label as plain text, never a link.
const LINK_TOKEN_RE = /\[([^\]]+)\]\(([^)\s]+)\)/;
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
// Note refs arrive as a bare id or a `notes/<id>` href — grounded citations from Ask AI.
const NOTE_HREF_RE = new RegExp(`^(?:notes/)?(${UUID})$`);

function inline(text: string, opts?: MarkdownOpts): ReactNode[] {
  // Split on [link](target), **bold**, and *italic* spans; everything else is plain text.
  const tokens = text.split(/(\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return tokens.map((t, i) => {
    const link = t.match(LINK_TOKEN_RE);
    if (link) {
      const [, label, href] = link;
      if (/^https?:\/\//i.test(href))
        return (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-summary underline underline-offset-2 break-words"
          >
            {label}
          </a>
        );
      const note = href.match(NOTE_HREF_RE);
      if (note && opts?.onNoteClick) {
        const id = note[1];
        return (
          <button
            key={i}
            type="button"
            onClick={() => opts.onNoteClick!(id)}
            className="inline text-left text-summary underline underline-offset-2 break-words"
          >
            {label}
          </button>
        );
      }
      // Unknown/unsafe target (or no note handler): show the label, never a live link.
      return label;
    }
    if (t.startsWith("**") && t.endsWith("**") && t.length > 4)
      return <strong key={i}>{t.slice(2, -2)}</strong>;
    if (t.startsWith("*") && t.endsWith("*") && t.length > 2)
      return <em key={i}>{t.slice(1, -1)}</em>;
    return t;
  });
}

export function renderMarkdown(text: string, opts?: MarkdownOpts): ReactNode {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = (key: number) => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{inline(item, opts)}</li>);
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
          {inline(heading[1], opts)}
        </h3>,
      );
      return;
    }
    blocks.push(<p key={i}>{inline(line, opts)}</p>);
  });
  flushList(lines.length);

  return <div className="space-y-2 text-sm leading-relaxed text-ink">{blocks}</div>;
}
