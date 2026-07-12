import { Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import type { CollectionDigest as CollectionDigestData } from "@/lib/types";
import type { NoteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";

// One deep-linking row inside a section card: a quiet index number, then title + summary
// run together on a single truncated line (glossary/field-guide anatomy) so many short
// entries stay scannable without each one claiming its own paragraph of vertical space.
// The whole row is the link; hover is a neutral ink tint plus a small arrow that slides in
// on md+ (mouse users get the affordance, touch users don't need it).
function DigestEntryRow({
  index,
  noteId,
  title,
  summary,
}: {
  index: number;
  noteId: string;
  title: string;
  summary: string;
}) {
  return (
    <Link
      to="/notes/$noteId"
      params={{ noteId }}
      className={`group flex items-center gap-3 px-4 py-2 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-ink/5 sm:px-5 ${FOCUS_RING}`}
    >
      <span
        className="w-5 shrink-0 text-right text-[11px] tabular-nums text-ink-soft/40"
        aria-hidden="true"
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm leading-snug">
        <span className="font-medium text-ink">{title}</span>
        {summary && <span className="text-ink-soft"> · {summary}</span>}
      </span>
      <ArrowRight
        aria-hidden="true"
        className="hidden h-3.5 w-3.5 shrink-0 -translate-x-1 text-ink-soft opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 md:block"
      />
    </Link>
  );
}

// Compact section header: an accent dot (the collection's own colour when it has one, a
// neutral tick otherwise), a small-caps label, the entry count, and a hairline rule that
// runs out to the section card's edge — a running-head, not another floating serif heading.
function DigestSectionHeader({
  heading,
  count,
  accent,
}: {
  heading: string;
  count: number;
  accent?: NoteAccent | null;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 px-1">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${accent ? accent.dot : "bg-ink-soft/40"}`}
        aria-hidden="true"
      />
      <h2 className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
        {heading}
      </h2>
      <span className="shrink-0 text-[11px] tabular-nums text-ink-soft/50">{count}</span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

// The "living view" composed from a collection's member notes: a serif lede, an optional
// at-a-glance stat row, and categorized sections whose rows deep-link back to source notes.
// Editorial-index layout: a tight prose measure, dense divided rows, distinct spacing only
// between sections (never within one) — designed for many short entries per section, not a
// few long ones. `accent` is the collection's own colour (from its palette pick, if any) —
// used only as a quiet section marker, since a digest spans a whole collection, not one note type.
export function CollectionDigest({
  digest,
  updating = false,
  accent,
}: {
  digest: CollectionDigestData;
  updating?: boolean;
  accent?: NoteAccent | null;
}) {
  return (
    <div className="max-w-prose space-y-8">
      {updating && (
        <div className="flex justify-end">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-2.5 py-0.5 text-[11px] text-ink-soft">
            <Sparkles className="h-3 w-3 animate-pulse" />
            Updating…
          </span>
        </div>
      )}

      <p className="font-serif text-2xl leading-snug text-ink md:text-3xl">{digest.intro}</p>

      {digest.facts.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-3 border-y border-border/70 py-3">
          {digest.facts.map((f, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <dt className="text-[11px] uppercase tracking-wider text-ink-soft/70">{f.label}</dt>
              <dd className="text-sm font-medium text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="space-y-9">
        {digest.sections.map((sec, i) => (
          <section key={i}>
            <DigestSectionHeader heading={sec.heading} count={sec.items.length} accent={accent} />
            <div className="rounded-2xl border border-border bg-card">
              <div className="divide-y divide-border/60">
                {sec.items.map((item, j) => (
                  <DigestEntryRow
                    key={j}
                    index={j}
                    noteId={item.note_id}
                    title={item.title}
                    summary={item.summary}
                  />
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>

      {digest.coverage && <p className="text-[11px] text-ink-soft/70">{digest.coverage}</p>}
    </div>
  );
}
