import { MapPin, Star, Clock, Wallet, Sparkles, Lightbulb, Utensils, ChevronDown } from "lucide-react";
import type { Note, PlaceAction } from "@/lib/types";
import { noteAccent } from "@/lib/note-meta";
import { ActionRow } from "@/components/shared/ActionRow";
import { VenuesMap } from "../VenuesMap";
import { useImageAspect, orientationOf } from "../useImageAspect";

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

// A venue photo, laid out by its own aspect so it never gets brutally center-cropped and
// never dominates the venue card. Landscape → a modest banner (a mild crop reads as
// intentional); portrait/square → a contained image centered on the note's accent wash,
// shown in full. We measure off-screen first so the layout doesn't flash; a banner-shaped
// box holds the space meanwhile.
function VenuePhoto({ url, alt, accent }: { url: string; alt: string; accent: Accent }) {
  const { status, ratio } = useImageAspect(url);

  if (status === "loading") {
    return <div className={`h-48 w-full rounded-2xl border border-border sm:h-56 ${accent.soft}`} />;
  }
  if (status === "none") return null;

  if (orientationOf(ratio) === "landscape") {
    return (
      <div className="overflow-hidden rounded-2xl border border-border">
        <img src={url} alt={alt} loading="lazy" className="h-48 w-full object-cover sm:h-56" />
      </div>
    );
  }
  // Portrait / square: contained at its own aspect so nothing gets cut off.
  return (
    <div className={`flex justify-center rounded-2xl border border-border p-3 ${accent.soft}`}>
      <img
        src={url}
        alt={alt}
        loading="lazy"
        style={{ aspectRatio: ratio }}
        className="max-h-80 w-auto max-w-full rounded-xl object-cover"
      />
    </div>
  );
}

// Google's opening_hours weekday lines look like "Friday: 9:00 AM – 11:00 PM". Pull out
// today's hours for the compact disclosure summary; null when the format doesn't match.
function todaysHours(hours: string[]): string | null {
  const day = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const line = hours.find((h) => h.startsWith(day));
  if (!line) return null;
  const rest = line.slice(day.length).replace(/^:\s*/, "").trim();
  return rest || null;
}

function VenueBlock({ v, accent, showName }: { v: Venue; accent: Accent; showName: boolean }) {
  // Compact inline rating: star glyph + "4.6 (188)". Google's numeric rating gets its review
  // count; a source-said string renders as-is. Sits beside the name (multi-venue) or leads
  // the meta line (single venue, where the note title is already the venue name).
  const ratingText = v.rating
    ? typeof v.rating === "number" && v.user_rating_count
      ? `${v.rating} (${v.user_rating_count.toLocaleString()})`
      : String(v.rating)
    : null;
  const rating = ratingText ? (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-ink">
      <Star className={`h-3.5 w-3.5 shrink-0 fill-current ${accent.text}`} />
      {ratingText}
    </span>
  ) : null;

  const price = v.priceForTwo || v.priceRange || v.price_level;
  const liveHours = (v.opening_hours?.length ?? 0) > 0;
  const today = liveHours ? todaysHours(v.opening_hours!) : null;
  const hasMeta = Boolean(
    (!showName && rating) ||
      v.location ||
      v.formatted_address ||
      v.category ||
      v.cuisine ||
      price ||
      (v.timings && !liveHours),
  );

  return (
    <div className="space-y-5">
      {showName && v.name && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="min-w-0 font-serif text-2xl text-ink">{v.name}</h2>
          {rating}
        </div>
      )}

      {hasMeta && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-soft">
          {!showName && rating}
          {(v.location || v.formatted_address) && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className={`h-3.5 w-3.5 shrink-0 ${accent.text}`} />
              <span className="text-ink">{v.location || v.formatted_address}</span>
            </span>
          )}
          {(v.category || v.cuisine) && (
            <span>{[v.category, v.cuisine].filter(Boolean).join(" · ")}</span>
          )}
          {price && (
            <span className="inline-flex items-center gap-1.5">
              <Wallet className={`h-3.5 w-3.5 shrink-0 ${accent.text}`} />
              {price}
            </span>
          )}
          {/* Source-said hours; skipped when live Google hours render below. */}
          {v.timings && !liveHours && (
            <span className="inline-flex items-center gap-1.5">
              <Clock className={`h-3.5 w-3.5 shrink-0 ${accent.text}`} />
              {v.timings}
            </span>
          )}
        </div>
      )}

      {v.photo_url && <VenuePhoto url={v.photo_url} alt={v.name ?? ""} accent={accent} />}

      {/* Region-aware actions built by backend enrichment (Directions / Reserve / Order / …). */}
      <ActionRow actions={v.action_links} />

      {/* Live hours as a compact one-line disclosure: today's hours in the summary, the
          full week on expand. Never a full-width bar. */}
      {liveHours && (
        <details className="group text-sm">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-ink-soft transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
            <Clock className={`h-3.5 w-3.5 shrink-0 ${accent.text}`} />
            <span>{today ? `Today · ${today}` : "Opening hours"}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-2 space-y-1 pl-5 text-ink-soft">
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
