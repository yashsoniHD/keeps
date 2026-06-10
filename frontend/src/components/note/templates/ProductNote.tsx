import { Star, Check, X, ExternalLink } from "lucide-react";
import type { Note } from "@/lib/types";

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

export function ProductNote({ note }: { note: Note }) {
  const data = note.data as ProductData;
  return (
    <div>
      <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:gap-12">
        {note.cover_image_url && (
          <div className="overflow-hidden rounded-3xl border border-border bg-product-soft/30">
            <img
              src={note.cover_image_url}
              alt={note.title}
              className="h-80 w-full object-contain p-4 md:h-[28rem]"
            />
          </div>
        )}

        <div className="flex flex-col">
          {data.brand && (
            <div className="text-sm uppercase tracking-wider text-ink-soft">{data.brand}</div>
          )}
          <div className="mt-3 flex items-baseline gap-3">
            {data.price && <span className="font-serif text-4xl text-ink">{data.price}</span>}
            {data.rating != null && (
              <span className="inline-flex items-center gap-1 text-sm text-ink-soft">
                <Star className="h-3.5 w-3.5 fill-product text-product" />
                {data.rating}
              </span>
            )}
          </div>

          <a
            href={data.buyUrl ?? note.source_url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-product px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
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

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {data.pros && data.pros.length > 0 && (
          <ProsCons title="Pros" items={data.pros} icon={Check} tone="positive" />
        )}
        {data.cons && data.cons.length > 0 && (
          <ProsCons title="Cons" items={data.cons} icon={X} tone="negative" />
        )}
      </div>

      {data.verdict && (
        <blockquote className="mt-8 rounded-2xl border border-border bg-product-soft/30 p-5">
          <div className="text-xs uppercase tracking-wider text-product">Verdict</div>
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
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-serif text-xl text-ink">{title}</h3>
      <ul className="mt-3 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2.5 text-ink">
            <span
              className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                tone === "positive"
                  ? "bg-itinerary-soft text-itinerary"
                  : "bg-recipe-soft text-recipe"
              }`}
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
