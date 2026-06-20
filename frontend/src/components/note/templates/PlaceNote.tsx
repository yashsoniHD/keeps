import { MapPin, Star, Clock, Wallet, Sparkles, Lightbulb } from "lucide-react";
import type { Note } from "@/lib/types";
import { noteAccent } from "@/lib/note-meta";

// Matches the backend `place` schema (services/gemini.py TYPE_PROMPTS["place"]):
// a single venue worth visiting — restaurant, cafe, attraction, hotel.
interface PlaceData {
  name?: string;
  location?: string;
  category?: string;
  priceRange?: string;
  rating?: string;
  timings?: string;
  facts?: { label: string; value: string }[];
  highlights?: string[];
  tips?: string[];
}

export function PlaceNote({ note }: { note: Note }) {
  const data = note.data as PlaceData;
  const accent = noteAccent(note.content_type);

  const stats: { icon: typeof Star; label: string; value: string }[] = [];
  if (data.rating) stats.push({ icon: Star, label: "Rating", value: data.rating });
  if (data.priceRange) stats.push({ icon: Wallet, label: "Price", value: data.priceRange });
  if (data.timings) stats.push({ icon: Clock, label: "Hours", value: data.timings });

  return (
    <div className="space-y-10">
      {(data.location || data.category) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-soft">
          {data.location && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className={`h-4 w-4 ${accent.text}`} />
              <span className="text-ink">{data.location}</span>
            </span>
          )}
          {data.category && <span className="text-sm">· {data.category}</span>}
        </div>
      )}

      {stats.length > 0 && (
        <div
          className={`grid gap-3 rounded-2xl border border-border p-4 ${accent.soft}`}
          style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
        >
          {stats.map((s, i) => (
            <div key={i} className="flex flex-col items-center gap-1 text-center">
              <s.icon className={`h-4 w-4 ${accent.text}`} />
              <div className="text-xs uppercase tracking-wider text-ink-soft">{s.label}</div>
              <div className="font-serif text-lg text-ink">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {data.facts && data.facts.length > 0 && (
        <section className={`rounded-2xl border border-border p-5 ${accent.soft}`}>
          <dl className="divide-y divide-border/60">
            {data.facts.map((f, i) => (
              <div key={i} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-sm text-ink-soft">{f.label}</dt>
                <dd className="text-right text-sm font-medium text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {data.highlights && data.highlights.length > 0 && (
        <section>
          <h2 className="inline-flex items-center gap-2 font-serif text-2xl text-ink">
            <Sparkles className={`h-5 w-5 ${accent.text}`} /> Highlights
          </h2>
          <ul className="mt-4 space-y-3">
            {data.highlights.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-ink">
                <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.tips && data.tips.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="inline-flex items-center gap-2 font-serif text-xl text-ink">
            <Lightbulb className={`h-4 w-4 ${accent.text}`} /> Tips
          </h2>
          <ul className="mt-3 space-y-2.5">
            {data.tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-3 text-ink">
                <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
