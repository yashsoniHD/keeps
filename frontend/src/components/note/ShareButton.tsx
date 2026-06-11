import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import type { Note } from "@/lib/types";

// The note as plain text — title, summary, and the original link — ready to drop
// into WhatsApp / iMessage. Native share sheet on mobile, clipboard copy elsewhere.
export function ShareButton({ note }: { note: Note }) {
  const [copied, setCopied] = useState(false);

  const onShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const body = [note.title, note.ai_summary].filter(Boolean).join("\n\n");
    // Keep the URL only in `url` for the native sheet (apps append it themselves,
    // so duplicating it in `text` would show the link twice).
    const shareData = { title: note.title, text: body, url: note.source_url };

    if (navigator.share && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
      } catch {
        // User dismissed the share sheet — not an error.
      }
      return;
    }

    try {
      await navigator.clipboard.writeText([body, note.source_url].filter(Boolean).join("\n\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context, denied permission) — nothing to do.
    }
  };

  return (
    <button
      type="button"
      aria-label={copied ? "Copied to clipboard" : "Share note"}
      onClick={onShare}
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full border text-sm transition-colors ${
        copied
          ? "border-border bg-card px-3 text-ink"
          : "w-9 border-border bg-card text-ink-soft hover:text-ink"
      }`}
    >
      {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
      {copied && "Copied!"}
    </button>
  );
}
