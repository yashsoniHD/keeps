import {
  MapPin,
  Star,
  Clock,
  Wallet,
  Sparkles,
  Lightbulb,
  Utensils,
  ChevronDown,
} from "lucide-react";
import type { Note, PlaceAction } from "@/lib/types";
import { noteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import { ActionRow } from "@/components/shared/ActionRow";
import { SmartImage } from "../SmartImage";
import { FactsBlock } from "../FactsBlock";
import { DataTable } from "../DataTable";

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
  // note-level at-a-glance facts about the list itself (multi-venue roundups); rendered at the
  // top. Also the legacy single-venue facts field — folded into the single venue below.
  facts?: { label: string; value: string }[];
  table?: import("../DataTable").TableData;
  // legacy single-venue fields
  name?: string;
  location?: string;
  category?: string;
  priceRange?: string;
  rating?: string;
  timings?: string;
  highlights?: string[];
  tips?: string[];
}

type Accent = ReturnType<typeof noteAccent>;

// Google's opening_hours weekday lines look like "Friday: 9:00 AM – 11:00 PM". Pull out
// today's hours for the compact disclosure summary; null when the format doesn't match.
function todaysHours(hours: string[]): string | null {
  const day = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const line = hours.find((h) => h.startsWith(day));
  if (!line) return null;
  const rest = line.slice(day.length).replace(/^:\s*/, "").trim();
  return rest || null;
}

function VenueBlock({
  v,
  accent,
  showName,
  index,
}: {
  v: Venue;
  accent: Accent;
  showName: boolean;
  index?: number;
}) {
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

  const number =
    showName && typeof index === "number" ? (
      <span className={`font-serif text-4xl leading-none md:text-5xl ${accent.text}`}>
        {String(index + 1).padStart(2, "0")}
      </span>
    ) : null;

  const metaLine = hasMeta ? (
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
  ) : null;

  // Region-aware actions built by backend enrichment (Directions / Reserve / Order / …).
  const actionsRow = <ActionRow actions={v.action_links} />;

  // Live hours as a compact one-line disclosure: today's hours in the summary, the
  // full week on expand. Never a full-width bar.
  const hoursBlock = liveHours ? (
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
  ) : null;

  return (
    <div className="space-y-5">
      {showName ? (
        // Header, meta, actions and hours share the column BESIDE the thumbnail, so a long
        // address wraps around the image instead of leaving a blank band under the name.
        <div className="flex items-start gap-5">
          <div className="min-w-0 flex-1 space-y-4">
            {v.name && (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {number}
                <h2 className="min-w-0 font-serif text-2xl text-ink">{v.name}</h2>
                {rating}
              </div>
            )}
            {metaLine}
            {/* Full-width photo on mobile (the sm+ thumbnail sits beside this column). */}
            {v.photo_url && (
              <img
                src={v.photo_url}
                alt={v.name ?? ""}
                loading="lazy"
                className="aspect-[16/9] w-full rounded-xl border border-border object-cover sm:hidden"
              />
            )}
            {actionsRow}
            {hoursBlock}
          </div>
          {v.photo_url && (
            <img
              src={v.photo_url}
              alt={v.name ?? ""}
              loading="lazy"
              className="hidden h-24 w-32 shrink-0 rounded-xl border border-border object-cover sm:block md:h-28 md:w-40"
            />
          )}
        </div>
      ) : (
        <>
          {metaLine}
          {/* Single-venue: a generous photo laid out by its own aspect (blur-fill for portraits). */}
          {v.photo_url && (
            <SmartImage
              src={v.photo_url}
              alt={v.name ?? ""}
              frameClass="aspect-[4/3] rounded-2xl border border-border sm:aspect-[3/2]"
            />
          )}
          {actionsRow}
          {hoursBlock}
        </>
      )}

      <FactsBlock facts={v.facts} accent={accent} />

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

  // Compact "category · rating" line for the jump-to index rows (mirrors VenueBlock's rating).
  const venueMeta = (v: Venue): string => {
    const cat = v.category || v.cuisine;
    const ratingText =
      v.rating != null && v.rating !== ""
        ? typeof v.rating === "number" && v.user_rating_count
          ? `${v.rating} (${v.user_rating_count.toLocaleString()})`
          : String(v.rating)
        : null;
    return [cat, ratingText].filter(Boolean).join(" · ");
  };

  return (
    <div className="space-y-10">
      {data.listTheme && multi && (
        <p className="text-sm uppercase tracking-wider text-ink-soft">{data.listTheme}</p>
      )}

      {/* Note-level at-a-glance facts about the list itself (multi-venue roundups only; a lone
          venue's own facts render inside its block). */}
      {multi && <FactsBlock facts={data.facts} accent={accent} />}
      {multi && data.table && <DataTable table={data.table} accent={accent} />}

      {/* Jump-to index for a roundup: tap a row to scroll to that venue. */}
      {venues.length >= 3 && (
        <nav className="rounded-2xl border border-border bg-card p-2">
          {venues.map((v, i) => {
            const meta = venueMeta(v);
            return (
              <button
                key={i}
                type="button"
                onClick={() =>
                  document.getElementById(`venue-${i + 1}`)?.scrollIntoView({ behavior: "smooth" })
                }
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/50 ${FOCUS_RING}`}
              >
                <span className={`w-7 shrink-0 text-center font-serif text-lg ${accent.text}`}>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{v.name}</span>
                {meta && <span className="shrink-0 text-sm text-ink-soft">{meta}</span>}
              </button>
            );
          })}
        </nav>
      )}

      {venues.map((v, i) => (
        <div
          key={i}
          id={`venue-${i + 1}`}
          className={`scroll-mt-24 ${i > 0 ? "border-t border-border pt-10" : ""}`}
        >
          <VenueBlock v={v} accent={accent} showName={multi} index={i} />
        </div>
      ))}
    </div>
  );
}
