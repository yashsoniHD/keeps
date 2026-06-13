import { useState } from "react";
import { Check, Share2, Loader2, Globe, Lock } from "lucide-react";
import type { Note } from "@/lib/types";
import { shareNote, unshareNote } from "@/lib/api";

// Sharing a note publishes it: the backend flips is_public, and we share a public
// /p/{id} link anyone can open (no login) — the receiver reads the full note plus a
// sign-up CTA. Native share sheet on mobile, clipboard copy elsewhere. A "Make private"
// affordance appears once shared so the owner can revoke access.
export function ShareButton({ note }: { note: Note }) {
  const [isPublic, setIsPublic] = useState(note.is_public === true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const publicUrl = () => `${window.location.origin}/p/${note.id}`;

  const onShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      // Ensure the note is public before handing out the link.
      if (!isPublic) {
        await shareNote(note.id);
        setIsPublic(true);
      }
      const url = publicUrl();
      const shareData = { title: note.title, text: note.title, url };
      if (navigator.share && navigator.canShare?.(shareData)) {
        try {
          await navigator.share(shareData);
        } catch {
          // User dismissed the share sheet — not an error.
        }
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard blocked (insecure context, denied permission) — nothing to do.
      }
    } catch {
      // Share endpoint failed — leave the note private; the button can be retried.
    } finally {
      setBusy(false);
    }
  };

  const onMakePrivate = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await unshareNote(note.id);
      setIsPublic(false);
    } catch {
      // Leave it public on failure — retryable.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={copied ? "Link copied to clipboard" : "Share note"}
        onClick={onShare}
        disabled={busy}
        className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full border text-sm transition-colors disabled:opacity-60 ${
          copied || isPublic
            ? "border-border bg-card px-3 text-ink"
            : "w-9 border-border bg-card text-ink-soft hover:text-ink"
        }`}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : copied ? (
          <Check className="h-4 w-4" />
        ) : isPublic ? (
          <Globe className="h-4 w-4" />
        ) : (
          <Share2 className="h-4 w-4" />
        )}
        {copied ? "Copied!" : isPublic ? "Share" : null}
      </button>

      {isPublic && !copied && (
        <button
          type="button"
          onClick={onMakePrivate}
          disabled={busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-xs text-ink-soft transition-colors hover:text-ink disabled:opacity-60"
        >
          <Lock className="h-3.5 w-3.5" />
          Make private
        </button>
      )}
    </div>
  );
}
