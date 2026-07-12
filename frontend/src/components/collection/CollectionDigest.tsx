import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import type { CollectionDigest as CollectionDigestData } from "@/lib/types";
import type { Note } from "@/lib/types";
import type { NoteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";

// One deep-linking row inside a section's supporting list: a quiet index number, then title +
// summary run together on a single truncated line. `dense` shrinks it further (text + padding)
// for when it trails prose, since the list is now a subordinate scan aid, not the main content.
function DigestEntryRow({
  index,
  noteId,
  title,
  summary,
  dense = false,
}: {
  index: number;
  noteId: string;
  title: string;
  summary: string;
  dense?: boolean;
}) {
  return (
    <Link
      to="/notes/$noteId"
      params={{ noteId }}
      className={`group flex items-center gap-3 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-ink/5 ${
        dense ? "px-3.5 py-1.5 sm:px-4" : "px-4 py-2 sm:px-5"
      } ${FOCUS_RING}`}
    >
      <span
        className={`w-5 shrink-0 text-right tabular-nums text-ink-soft/40 ${dense ? "text-[10px]" : "text-[11px]"}`}
        aria-hidden="true"
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className={`min-w-0 flex-1 truncate leading-snug ${dense ? "text-xs" : "text-sm"}`}>
        <span className="font-medium text-ink">{title}</span>
        {summary && <span className="text-ink-soft"> · {summary}</span>}
      </span>
      <ArrowRight
        aria-hidden="true"
        className={`hidden shrink-0 -translate-x-1 text-ink-soft opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 md:block ${
          dense ? "h-3 w-3" : "h-3.5 w-3.5"
        }`}
      />
    </Link>
  );
}

// Compact section header: an accent dot (the collection's own colour when it has one, a
// neutral tick otherwise), a small-caps label, an optional entry count, and a hairline rule
// that runs out to the section's edge — a running-head, not another floating serif heading.
// Given a slightly taller bottom margin now that prose follows it, so the header reads as
// an introduction to the paragraphs rather than a tight list caption.
function DigestSectionHeader({
  heading,
  count,
  accent,
}: {
  heading: string;
  count?: number;
  accent?: NoteAccent | null;
}) {
  return (
    <div className="mb-3 flex items-center gap-2 px-1">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${accent ? accent.dot : "bg-ink-soft/40"}`}
        aria-hidden="true"
      />
      <h2 className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
        {heading}
      </h2>
      {!!count && (
        <span className="shrink-0 text-[11px] tabular-nums text-ink-soft/50">{count}</span>
      )}
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

// The synthesized prose for a section, split on blank lines into paragraphs. This is the
// star of the digest now: comfortable reading size and leading, `text-ink` throughout, with
// the first paragraph a touch stronger since it usually carries the section's thesis.
function DigestSectionBody({ body }: { body: string }) {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  return (
    <div className="space-y-3 px-1">
      {paragraphs.map((p, i) => (
        <p
          key={i}
          className={`text-[15px] leading-relaxed text-ink sm:text-[16px] ${
            i === 0 ? "font-medium" : "font-normal"
          }`}
        >
          {p}
        </p>
      ))}
    </div>
  );
}

// One quiet citation chip in a section's "From:" row — the note's favicon (cheap: Google's
// favicon service keyed off the note's own source_domain, same idiom as SourcePill/NoteCard)
// plus its truncated title, linking back to the note. Falls back to just the title when the
// note has no web domain (typed/uploaded captures).
function DigestSourceChip({ note }: { note: Note }) {
  const title = note.title.length > 30 ? `${note.title.slice(0, 30).trimEnd()}…` : note.title;
  return (
    <Link
      to="/notes/$noteId"
      params={{ noteId: note.id }}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-card px-2.5 py-1 text-xs text-ink-soft transition-colors hover:bg-accent hover:text-ink ${FOCUS_RING}`}
    >
      {note.source_domain && (
        <img
          src={`https://www.google.com/s2/favicons?domain=${note.source_domain}&sz=32`}
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
          alt=""
          className="h-3 w-3 shrink-0 rounded-sm"
        />
      )}
      <span className="min-w-0 truncate">{title}</span>
    </Link>
  );
}

// The quiet "From:" row grounding a section in the notes it was synthesized from. Ids with
// no matching live note (deleted, or membership drifted since the digest was built) render
// nothing rather than a broken link.
function DigestSectionSources({
  ids,
  notesById,
}: {
  ids: string[];
  notesById: Map<string, Note>;
}) {
  const matched = ids.map((id) => notesById.get(id)).filter((n): n is Note => !!n);
  if (matched.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 px-1">
      <span className="shrink-0 text-[11px] uppercase tracking-wider text-ink-soft/50">From</span>
      {matched.map((n) => (
        <DigestSourceChip key={n.id} note={n} />
      ))}
    </div>
  );
}

// The "living view" composed from a collection's member notes: a serif lede, an optional
// at-a-glance stat row, and sections that now read like a briefing — synthesized prose first,
// an optional dense list of the notes it drew from, and a quiet citation row. `notes` is the
// collection's live member set (passed down by the route, which already holds it) so section
// bodies' `source_note_ids` can resolve to real titles/links without a second fetch.
// Editorial-index layout: a tight prose measure, generous paragraph rhythm within a section,
// distinct spacing only between sections. `accent` is the collection's own colour (from its
// palette pick, if any) — used only as a quiet section marker, since a digest spans a whole
// collection, not one note type.
export function CollectionDigest({
  digest,
  notes,
  updating = false,
  accent,
}: {
  digest: CollectionDigestData;
  notes: Note[];
  updating?: boolean;
  accent?: NoteAccent | null;
}) {
  const notesById = useMemo(() => new Map(notes.map((n) => [n.id, n] as const)), [notes]);

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
        {digest.sections.map((sec, i) => {
          const items = sec.items ?? [];
          const sourceIds = sec.source_note_ids ?? [];
          return (
            <section key={i}>
              <DigestSectionHeader heading={sec.heading} count={items.length} accent={accent} />
              {sec.body && <DigestSectionBody body={sec.body} />}
              {items.length > 0 && (
                <div className={sec.body ? "mt-4" : ""}>
                  {sec.body && (
                    <p className="mb-1.5 px-1 text-[11px] uppercase tracking-wider text-ink-soft/50">
                      Mentioned above, as a list
                    </p>
                  )}
                  <div className="rounded-2xl border border-border/70 bg-card/60">
                    <div className="divide-y divide-border/50">
                      {items.map((item, j) => (
                        <DigestEntryRow
                          key={j}
                          index={j}
                          noteId={item.note_id}
                          title={item.title}
                          summary={item.summary}
                          dense
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {sourceIds.length > 0 && <DigestSectionSources ids={sourceIds} notesById={notesById} />}
            </section>
          );
        })}
      </div>

      {digest.coverage && <p className="text-[11px] text-ink-soft/70">{digest.coverage}</p>}
    </div>
  );
}
