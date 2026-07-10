import { MapPin, Star, Clock, Wallet, Sparkles, Lightbulb, Utensils } from "lucide-react";
import type { Note, PlaceAction } from "@/lib/types";
import { noteAccent } from "@/lib/note-meta";
import { ActionRow } from "../ActionRow";
import { VenuesMap } from "../VenuesMap";

// One venue in a place note. camelCase fields match the backend `place` venues[] schema
// (services/gemini.py TYPE_PROMPTS["place"] — what the source said); snake_case fields are
// backend Google-Places enrichment (looked up: photo, coords, live rating, hours, links). The
// legacy single-venue shape (pre-venues[]) is normalized into a one-element array below.
interface Venue {
  name?: string;
  location?: string;
  city?: string;
  category?: string;
  cuisine?: string;
  priceForTwo?: string;
  priceRange?: string; // legacy
  rating?: string | number; // source string, or Google numeric after enrichment
  timings?: string;
  mustTry?: string[];
  goodFor?: string[];
  bestTime?: string;
  facts?: { label: string; value: string }[]; // legacy
  highlights?: string[];
  tips?: string[];
  why?: string;
  // enrichment (Google Places)
  place_id?: string;
  formatted_address?: string | null;
  lat?: number | null;
  lng?: number | null;
  user_rating_count?: number | null;
  price_level?: string | null;
  opening_hours?: string[];
  website?: string | null;
  phone?: string | null;
  photo_url?: string | null;
  action_links?: PlaceAction[];
}

interface PlaceData {
  venues?: Venue[];
  listTheme?: string;
  // legacy single-venue fields
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

type Accent = ReturnType<typeof noteAccent>;

function VenueBlock({ v, accent, showName }: { v: Venue; accent: Accent; showName: boolean }) {
  const stats: { icon: typeof Star; label: string; value: string }[] = [];
  if (v.rating) {
    // Google's numeric rating gets its review count; a source-said string renders as-is.
    const value =
      typeof v.rating === "number" && v.user_rating_count
        ? `${v.rating} (${v.user_rating_count.toLocaleString()})`
        : String(v.rating);
    stats.push({ icon: Star, label: "Rating", value });
  }
  const price = v.priceForTwo || v.priceRange || v.price_level;
  if (price) stats.push({ icon: Wallet, label: "Price", value: price });
  if (v.timings) stats.push({ icon: Clock, label: "Hours", value: v.timings });

  return (
    <div className="space-y-6">
      {showName && v.name && <h2 className="font-serif text-2xl text-ink">{v.name}</h2>}

      {v.photo_url && (
        <div className="overflow-hidden rounded-2xl border border-border">
          <img
            src={v.photo_url}
            alt={v.name ?? ""}
            loading="lazy"
            className="h-52 w-full object-cover"
          />
        </div>
      )}

      {(v.location || v.formatted_address || v.category || v.cuisine) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-soft">
          {(v.location || v.formatted_address) && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className={`h-4 w-4 ${accent.text}`} />
              <span className="text-ink">{v.location || v.formatted_address}</span>
            </span>
          )}
          {(v.category || v.cuisine) && (
            <span className="text-sm">· {[v.category, v.cuisine].filter(Boolean).join(" · ")}</span>
          )}
        </div>
      )}

      {/* Region-aware actions built by backend enrichment (Directions / Reserve / Order / …). */}
      <ActionRow actions={v.action_links} />

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

      {(v.opening_hours?.length ?? 0) > 0 && (
        <details className="rounded-2xl border border-border bg-card px-5 py-3">
          <summary
            className={`inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-ink`}
          >
            <Clock className={`h-4 w-4 ${accent.text}`} /> Opening hours
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-ink-soft">
            {v.opening_hours!.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </details>
      )}

      {v.facts && v.facts.length > 0 && (
        <section className={`rounded-2xl border border-border p-5 ${accent.soft}`}>
          <dl className="divide-y divide-border/60">
            {v.facts.map((f, i) => (
              <div key={i} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-sm text-ink-soft">{f.label}</dt>
                <dd className="text-right text-sm font-medium text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {v.mustTry && v.mustTry.length > 0 && (
        <section>
          <h3 className="inline-flex items-center gap-2 font-serif text-xl text-ink">
            <Utensils className={`h-4 w-4 ${accent.text}`} /> Must try
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {v.mustTry.map((m, i) => (
              <span key={i} className={`rounded-full px-2.5 py-1 text-sm ${accent.chip}`}>
                {m}
              </span>
            ))}
          </div>
        </section>
      )}

      {v.highlights && v.highlights.length > 0 && (
        <section>
          <h3 className="inline-flex items-center gap-2 font-serif text-xl text-ink">
            <Sparkles className={`h-5 w-5 ${accent.text}`} /> Highlights
          </h3>
          <ul className="mt-4 space-y-3">
            {v.highlights.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-ink">
                <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {v.goodFor && v.goodFor.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {v.goodFor.map((g, i) => (
            <span
              key={i}
              className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-ink-soft"
            >
              {g}
            </span>
          ))}
        </div>
      )}

      {v.tips && v.tips.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <h3 className="inline-flex items-center gap-2 font-serif text-lg text-ink">
            <Lightbulb className={`h-4 w-4 ${accent.text}`} /> Tips
          </h3>
          <ul className="mt-3 space-y-2.5">
            {v.tips.map((tip, i) => (
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

// Renders a place note. New notes carry `data.venues[]` (one venue per saved spot, possibly many
// from a roundup); legacy notes carry a single venue's fields at the top level — normalized here.
export function PlaceNote({ note }: { note: Note }) {
  const data = note.data as PlaceData;
  const accent = noteAccent(note.content_type);

  const venues: Venue[] =
    Array.isArray(data.venues) && data.venues.length > 0
      ? data.venues
      : [
          {
            name: data.name,
            location: data.location,
            category: data.category,
            priceRange: data.priceRange,
            rating: data.rating,
            timings: data.timings,
            facts: data.facts,
            highlights: data.highlights,
            tips: data.tips,
          },
        ];

  const multi = venues.length > 1;

  return (
    <div className="space-y-12">
      {data.listTheme && multi && (
        <p className="text-sm uppercase tracking-wider text-ink-soft">{data.listTheme}</p>
      )}
      {/* Live map of enriched venues — renders nothing without a Maps key or coordinates. */}
      <VenuesMap venues={venues} heightClass={multi ? "h-[40vh]" : "h-56"} />
      {venues.map((v, i) => (
        <div key={i} className={i > 0 ? "border-t border-border pt-10" : ""}>
          <VenueBlock v={v} accent={accent} showName={multi} />
        </div>
      ))}
    </div>
  );
}
