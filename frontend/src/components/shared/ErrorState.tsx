import { Link } from "@tanstack/react-router";
import { FOCUS_RING } from "@/lib/ui";

// A full-height, house-style error / empty panel: serif title, soft body, and up to two ink-pill
// actions (an optional Retry and an optional "Back to home"). Used for note-load failures and any
// other terminal state where the surrounding view has nothing to show — it always offers a way out.
export function ErrorState({
  title,
  body,
  onRetry,
  retryLabel = "Retry",
  showHome = true,
}: {
  title: string;
  body?: string;
  onRetry?: () => void;
  retryLabel?: string;
  showHome?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <h1 className="font-serif text-2xl text-ink">{title}</h1>
        {body && <p className="mx-auto max-w-sm text-sm text-ink-soft">{body}</p>}
      </div>
      {(onRetry || showHome) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className={`rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 ${FOCUS_RING}`}
            >
              {retryLabel}
            </button>
          )}
          {showHome && (
            <Link
              to="/"
              className={`rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-accent ${FOCUS_RING}`}
            >
              Back to home
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
