import { Sparkles } from "lucide-react";

export function AISummaryBlock({ summary, className = "" }: { summary: string; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-card p-5 ${className}`}>
      <div className="mb-2 inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-ink-soft">
        <Sparkles className="h-3.5 w-3.5" />
        AI summary
      </div>
      <p className="font-serif text-xl leading-snug text-ink md:text-2xl">{summary}</p>
    </div>
  );
}
