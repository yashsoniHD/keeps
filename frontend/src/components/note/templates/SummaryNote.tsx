import { Play, Clock, Quote, ListChecks } from "lucide-react";
import type { Note } from "@/lib/types";

interface SummaryData {
  medium?: string;
  readTime?: string;
  videoLength?: string;
  tldr?: string;
  keyPoints?: string[];
  quotes?: { text: string; timestamp?: string }[];
  actionItems?: string[];
}

export function SummaryNote({ note }: { note: Note }) {
  const data = note.data as SummaryData;
  const isVideo = data.medium === "video";
  return (
    <div>
      <div className="mb-3 inline-flex items-center gap-2 text-xs uppercase tracking-wider text-ink-soft">
        {isVideo ? <Play className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
        {isVideo
          ? `Video${data.videoLength ? ` · ${data.videoLength}` : ""}`
          : `${data.medium ?? "Article"}${data.readTime ? ` · ${data.readTime}` : ""}`}
      </div>

      {data.tldr && (
        <div className="rounded-3xl bg-summary-soft/60 p-6 md:p-8">
          <div className="text-xs uppercase tracking-wider text-summary">TL;DR</div>
          <p className="mt-2 font-serif text-2xl leading-snug text-ink md:text-3xl">{data.tldr}</p>
        </div>
      )}

      {data.keyPoints && data.keyPoints.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-2xl text-ink">Key points</h2>
          <ol className="mt-4 space-y-4">
            {data.keyPoints.map((point, i) => (
              <li key={i} className="flex gap-4">
                <span className="font-serif text-2xl leading-none text-summary">{i + 1}</span>
                <p className="leading-relaxed text-ink">{point}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {data.quotes && data.quotes.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-2xl text-ink">Highlights</h2>
          <div className="mt-4 space-y-4">
            {data.quotes.map((q, i) => (
              <blockquote key={i} className="relative rounded-2xl border border-border bg-card p-5 pl-12">
                <Quote className="absolute left-4 top-5 h-5 w-5 text-summary" />
                <p className="font-serif text-lg leading-snug text-ink">"{q.text}"</p>
                {q.timestamp && <div className="mt-2 font-mono text-xs text-ink-soft">{q.timestamp}</div>}
              </blockquote>
            ))}
          </div>
        </section>
      )}

      {data.actionItems && data.actionItems.length > 0 && (
        <section className="mt-10 rounded-2xl border border-border bg-card p-5">
          <h2 className="inline-flex items-center gap-2 font-serif text-xl text-ink">
            <ListChecks className="h-4 w-4 text-summary" /> Action items
          </h2>
          <ul className="mt-3 space-y-2">
            {data.actionItems.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-ink">
                <span className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
