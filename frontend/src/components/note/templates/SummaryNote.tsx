import { Play, Clock, Quote, ListChecks } from "lucide-react";
import type { Note } from "@/lib/types";
import { noteAccent } from "@/lib/note-meta";
import { SectionHeader } from "../SectionHeader";
import { FactsBlock } from "../FactsBlock";

interface SummaryData {
  medium?: string;
  readTime?: string;
  videoLength?: string;
  tldr?: string;
  facts?: { label: string; value: string }[];
  keyPoints?: string[];
  quotes?: { text: string; timestamp?: string }[];
  actionItems?: string[];
}

export function SummaryNote({ note }: { note: Note }) {
  const data = note.data as SummaryData;
  const accent = noteAccent(note.content_type);
  const isVideo = data.medium === "video";
  return (
    <div className="space-y-10">
      {/* Medium label + TL;DR read as one unit, so they stay grouped inside the section rhythm. */}
      <div>
        <div className="mb-3 inline-flex items-center gap-2 text-xs uppercase tracking-wider text-ink-soft">
          {isVideo ? (
            <Play className={`h-3.5 w-3.5 ${accent.text}`} />
          ) : (
            <Clock className={`h-3.5 w-3.5 ${accent.text}`} />
          )}
          {isVideo
            ? `Video${data.videoLength ? ` · ${data.videoLength}` : ""}`
            : `${data.medium ?? "Article"}${data.readTime ? ` · ${data.readTime}` : ""}`}
        </div>

        {data.tldr && (
          <div className={`rounded-3xl p-6 md:p-8 ${accent.soft}`}>
            <div className={`text-xs uppercase tracking-wider ${accent.text}`}>TL;DR</div>
            {/* Sans, reading size: the TL;DR is a full paragraph, not a display heading —
                large serif turns multi-sentence text into a wall of italic-ish strokes. */}
            <p className="mt-2 text-base leading-relaxed text-ink md:text-lg">{data.tldr}</p>
          </div>
        )}
      </div>

      <FactsBlock facts={data.facts} accent={accent} />

      {data.keyPoints && data.keyPoints.length > 0 && (
        <section>
          <SectionHeader>Key points</SectionHeader>
          <ol className="mt-4 space-y-4">
            {data.keyPoints.map((point, i) => (
              <li key={i} className="flex gap-4">
                <span className={`font-serif text-2xl leading-none ${accent.text}`}>{i + 1}</span>
                <p className="leading-relaxed text-ink">{point}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {data.quotes && data.quotes.length > 0 && (
        <section>
          <SectionHeader>Highlights</SectionHeader>
          <div className="mt-4 space-y-4">
            {data.quotes.map((q, i) => (
              <blockquote
                key={i}
                className="relative rounded-2xl border border-border bg-card p-5 pl-12"
              >
                <Quote className={`absolute left-4 top-5 h-5 w-5 ${accent.text}`} />
                <p className="text-[15px] italic leading-relaxed text-ink md:text-base">
                  "{q.text}"
                </p>
                {q.timestamp && (
                  <div className="mt-2 font-mono text-xs text-ink-soft">{q.timestamp}</div>
                )}
              </blockquote>
            ))}
          </div>
        </section>
      )}

      {data.actionItems && data.actionItems.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <SectionHeader icon={ListChecks} iconClassName={accent.text}>
            Action items
          </SectionHeader>
          <ul className="mt-3 space-y-2">
            {data.actionItems.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-ink">
                <span
                  className={`mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${accent.border}`}
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
