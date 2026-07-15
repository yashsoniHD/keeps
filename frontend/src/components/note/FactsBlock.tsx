import type { NoteAccent } from "@/lib/note-meta";
import { StatGrid } from "./StatGrid";

// A note's at-a-glance `facts[]` block (label/value pairs). Shared so every template renders
// them the same way, choosing between two layouts by shape:
//   - 2–6 facts with short values → a centered StatGrid band (reads as an infographic row);
//   - anything else (one fact, many facts, or a long value) → a definition-list card, which
//     wraps gracefully where a rigid grid would crush the text.
export interface Fact {
  label: string;
  value: string;
}

// Short-enough values fit the centered grid cells without wrapping into a mess.
function fitsStatGrid(facts: Fact[]): boolean {
  return (
    facts.length >= 2 &&
    facts.length <= 6 &&
    facts.every((f) => String(f.value ?? "").length <= 28)
  );
}

export function FactsBlock({ facts, accent }: { facts?: Fact[]; accent: NoteAccent }) {
  if (!facts || facts.length === 0) return null;

  if (fitsStatGrid(facts)) {
    return <StatGrid stats={facts.map((f) => ({ label: f.label, value: f.value }))} accent={accent} />;
  }

  return (
    <section className={`rounded-2xl border border-border p-5 ${accent.soft}`}>
      <dl className="divide-y divide-border/60">
        {facts.map((f, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-sm text-ink-soft">{f.label}</dt>
            <dd className="text-right text-sm font-medium text-ink">{f.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
