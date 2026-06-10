import { ExternalLink } from "lucide-react";

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
        alt=""
        className="h-3.5 w-3.5 rounded-sm"
      />
      <span>{domain}</span>
      <ExternalLink className="h-3 w-3 opacity-60" />
    </a>
  );
}
