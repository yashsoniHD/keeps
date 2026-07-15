import { Star, Check, X, ExternalLink } from "lucide-react";
import type { Note } from "@/lib/types";
import { noteAccent } from "@/lib/note-meta";

interface ProductData {
  price?: string;
  brand?: string;
  rating?: string | number;
  buyUrl?: string;
  specs?: { label: string; value: string }[];
  pros?: string[];
  cons?: string[];
  verdict?: string;
}

// Pull the first number out of "4.5", "4.5/5", "Rated 4 stars" → 4.5 (0 if none).
function parseRating(raw: string | number | undefined): number {
  if (raw == null) return 0;
  if (typeof raw === "number") return raw;
  const m = raw.match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}

export function ProductNote({ note }: { note: Note }) {
  const data = note.data as ProductData;
  const accent = noteAccent(note.content_type);
  const rating = parseRating(data.rating);

  return (
    <div>
      <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:gap-12">
        {note.cover_image_url && (
          <div className="rounded-3xl border border-border bg-card p-6">
            <img
              src={note.cover_image_url}
              alt={note.title}
              className="max-h-80 w-full object-contain md:max-h-[26rem]"
            />
          </div>
        )}

        <div className="flex flex-col">
          {data.brand && (
            <div className="text-sm uppercase tracking-wider text-ink-soft">{data.brand}</div>
          )}
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
            {data.price && <span className="font-serif text-4xl text-ink">{data.price}</span>}
            {data.rating != null && data.rating !== "" && (
              <span className="inline-flex items-center gap-1.5 text-sm text-ink-soft">
                {rating > 0 && (
                  <span className="inline-flex">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-4 w-4 ${
                          i < Math.round(rating) ? `fill-current ${accent.text}` : "text-border"
                        }`}
                      />
                    ))}
                  </span>
                )}
                {data.rating}
              </span>
            )}
          </div>

          <a
            href={data.buyUrl ?? note.source_url}
            target="_blank"
            rel="noreferrer noopener"
            className={`mt-5 inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 ${accent.dot}`}
          >
            View on {note.source_domain}
            <ExternalLink className="h-4 w-4" />
          </a>

          {data.specs && data.specs.length > 0 && (
            <dl className="mt-7 divide-y divide-border rounded-2xl border border-border bg-card">
              {data.specs.map((s, i) => (
                <div key={i} className="flex items-baseline justify-between gap-4 px-4 py-3">
                  <dt className="text-sm text-ink-soft">{s.label}</dt>
                  <dd className="text-right text-sm text-ink">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      {((data.pros && data.pros.length > 0) || (data.cons && data.cons.length > 0)) && (
        <div className="mt-8 grid items-stretch gap-5 md:grid-cols-2">
          {data.pros && data.pros.length > 0 && (
            <ProsCons title="Pros" items={data.pros} icon={Check} tone="positive" />
          )}
          {data.cons && data.cons.length > 0 && (
            <ProsCons title="Cons" items={data.cons} icon={X} tone="negative" />
          )}
        </div>
      )}

      {data.verdict && (
        <blockquote className={`mt-8 rounded-2xl border border-border p-5 ${accent.soft}`}>
          <div className={`text-xs uppercase tracking-wider ${accent.text}`}>Verdict</div>
          <p className="mt-1 font-serif text-xl leading-snug text-ink">{data.verdict}</p>
        </blockquote>
      )}
    </div>
  );
}

function ProsCons({
  title,
  items,
  icon: Icon,
  tone,
}: {
  title: string;
  items: string[];
  icon: typeof Check;
  tone: "positive" | "negative";
}) {
  // Sage (itinerary) reads as "good", terracotta (recipe) as "caution" — both real
  // palette tokens, so they stay on-theme rather than introducing raw green/red.
  const toneClass = tone === "positive" ? "bg-place-soft text-place-chip" : "bg-recipe-soft text-recipe-chip";
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
      <h3 className="font-serif text-xl text-ink">{title}</h3>
      <ul className="mt-3 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2.5 text-ink">
            <span
              className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${toneClass}`}
            >
              <Icon className="h-3 w-3" />
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
