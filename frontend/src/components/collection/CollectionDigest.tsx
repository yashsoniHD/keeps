import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import type { CollectionDigest as CollectionDigestData } from "@/lib/types";
import { FOCUS_RING } from "@/lib/ui";

// One deep-linking entry inside a digest section: bold title line + a quieter summary line,
// mirroring the two-line rhythm of a note card excerpt.
function DigestEntryRow({ noteId, title, summary }: { noteId: string; title: string; summary: string }) {
  return (
    <Link
      to="/notes/$noteId"
      params={{ noteId }}
      className={`block rounded-xl px-3 py-2.5 -mx-3 transition-colors hover:bg-card ${FOCUS_RING}`}
    >
      <p className="font-medium leading-snug text-ink">{title}</p>
      {summary && <p className="mt-0.5 text-sm leading-snug text-ink-soft">{summary}</p>}
    </Link>
  );
}

// The "living view" composed from a collection's member notes: intro + optional at-a-glance
// facts + categorized sections whose entries deep-link back to source notes. Standalone —
// doesn't lean on note-type accents, since a digest spans a whole collection, not one type.
export function CollectionDigest({
  digest,
  updating = false,
}: {
  digest: CollectionDigestData;
  updating?: boolean;
}) {
  return (
    <div className="space-y-8">
      {updating && (
        <div className="flex justify-end">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-ink-soft">
            <Sparkles className="h-3 w-3 animate-pulse" />
            Updating…
          </span>
        </div>
      )}

      <p className="font-serif text-xl leading-relaxed text-ink md:text-2xl">{digest.intro}</p>

      {digest.facts.length > 0 && (
        <section className="rounded-2xl border border-border bg-card/50 p-5">
          <dl className="divide-y divide-border/60">
            {digest.facts.map((f, i) => (
              <div key={i} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-sm text-ink-soft">{f.label}</dt>
                <dd className="text-right text-sm font-medium text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {digest.sections.map((sec, i) => (
        <section key={i}>
          <h2 className="font-serif text-xl text-ink">{sec.heading}</h2>
          <div className="mt-2 divide-y divide-border/60">
            {sec.items.map((item, j) => (
              <DigestEntryRow key={j} noteId={item.note_id} title={item.title} summary={item.summary} />
            ))}
          </div>
        </section>
      ))}

      {digest.coverage && <p className="text-xs text-ink-soft">{digest.coverage}</p>}
    </div>
  );
}
