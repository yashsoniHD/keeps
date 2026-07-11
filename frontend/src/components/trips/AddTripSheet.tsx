import { useEffect, useRef, useState } from "react";
import { Link2, X, Loader2, Check } from "lucide-react";
import { ingest, ApiError } from "@/lib/api";
import { FOCUS_RING } from "@/lib/ui";

// Add a trip by pasting its link. Like the recipes app, a trip is added by running its URL through
// the normal ingest pipeline: the worker scrapes the page, Gemini structures it into an itinerary
// note, and the note fans out into a trip_item — which appears live via the parent's onSnapshot. So
// this sheet just kicks off ingest().
export function AddTripSheet({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const link = url.trim();
    if (!link || state === "submitting") return;
    setState("submitting");
    setError(null);
    try {
      await ingest(link);
      setState("done");
      // The new card lands via onSnapshot once the worker finishes; close after a beat.
      setTimeout(onClose, 1400);
    } catch (e) {
      setState("error");
      setError(e instanceof ApiError ? e.message : "Couldn't add that link. Please try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-background shadow-xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Link2 className="h-4 w-4 shrink-0 text-ink-soft" />
          <span className="flex-1 text-sm font-medium text-ink">Add a trip</span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={`rounded-full p-1 text-ink-soft hover:text-ink ${FOCUS_RING}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {state === "done" ? (
            <div className="flex items-center gap-2 rounded-xl bg-trip-soft px-3 py-4 text-sm text-trip">
              <Check className="h-4 w-4" />
              Got it — mapping out the days and stops. It’ll appear here in a moment.
            </div>
          ) : (
            <>
              <p className="text-sm text-ink-soft">
                Paste a link to any trip or itinerary. We’ll pull the day-by-day plan, stops and
                photo, and add it to your trips.
              </p>
              <input
                ref={inputRef}
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="https://…"
                className={`w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-soft ${FOCUS_RING}`}
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <button
                type="button"
                onClick={submit}
                disabled={!url.trim() || state === "submitting"}
                className={`inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-trip px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 ${FOCUS_RING}`}
              >
                {state === "submitting" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                Add to trips
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
