import { ExternalLink } from "lucide-react";
import { sourceLabel } from "@/lib/note-meta";

export function SourcePill({ domain, url }: { domain: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-ink-soft transition-colors hover:text-ink hover:bg-accent"
    >
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
        onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
        alt=""
        className="h-3.5 w-3.5 rounded-sm"
      />
      <span className="capitalize">{sourceLabel(domain)}</span>
      <ExternalLink className="h-3 w-3 opacity-60" />
    </a>
  );
}
