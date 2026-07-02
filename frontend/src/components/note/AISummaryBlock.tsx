import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

export function AISummaryBlock({
  summary,
  className = "",
}: {
  summary: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  // Only offer the more/less toggle when the (collapsed) summary actually spills past
  // two lines — short, single-sentence summaries then show no chrome at all.
  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      if (expanded) return; // measuring only makes sense in the clamped state
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [summary, expanded]);

  return (
    <div className={`rounded-2xl border border-border bg-card p-5 ${className}`}>
      <div className="mb-2 inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-ink-soft">
        <Sparkles className="h-3.5 w-3.5" />
        AI summary
      </div>
      <p
        ref={ref}
        className={`text-[15px] leading-relaxed text-ink md:text-base ${expanded ? "" : "line-clamp-2"}`}
      >
        {summary}
      </p>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-xs text-ink-soft underline-offset-2 hover:underline"
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </div>
  );
}
