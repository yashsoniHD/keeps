import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, BookOpen, RotateCw } from "lucide-react";
import { PillLink, PillButton } from "@/components/shared/PillButton";

// The status lines cycle while the story is being written, so the wait reads as work happening
// rather than a dead spinner. ~2.5s each — long enough to read, short enough to feel alive.
const STATUS_LINES = ["Reading your week", "Finding the thread", "Writing your story"];

// Shared full-screen shell for every pre-story state (loading / empty / error): the same
// self-colored overlay the stories use, so there's no jarring surface change when the real
// slides mount. Uses the summary accent (warm amber) as a calm, on-brand backdrop.
function DigestOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm md:p-4">
      <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-summary px-8 py-16 text-summary-on md:h-auto md:aspect-[9/16] md:max-h-[85vh] md:w-full md:max-w-md md:rounded-3xl md:shadow-2xl">
        <div className="pt-[env(safe-area-inset-top)]" />
        {children}
      </div>
    </div>
  );
}

export function DigestLoading() {
  const [line, setLine] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setLine((l) => (l + 1) % STATUS_LINES.length), 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <DigestOverlay>
      <Sparkles className="h-10 w-10 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
      <p
        key={line}
        className="mt-8 animate-in fade-in duration-700 font-serif text-3xl motion-reduce:animate-none"
        aria-live="polite"
      >
        {STATUS_LINES[line]}
      </p>
      <p className="mt-3 text-sm opacity-70">A recap of what you have been saving.</p>
    </DigestOverlay>
  );
}

// Zero notes: nothing to recap yet. A single friendly screen that points home to start saving.
export function DigestEmpty() {
  return (
    <DigestOverlay>
      <BookOpen className="h-10 w-10" aria-hidden="true" />
      <p className="mt-8 font-serif text-3xl">Nothing to recap yet</p>
      <p className="mt-3 max-w-xs text-center text-sm opacity-80">
        Save a few links and your digest will start telling the story of your week.
      </p>
      <PillLink to="/" variant="secondary" className="mt-8">
        Start saving
      </PillLink>
    </DigestOverlay>
  );
}

// The build failed outright (network / server) with no data to show. Quiet retry, never blank.
export function DigestError({ onRetry }: { onRetry: () => void }) {
  return (
    <DigestOverlay>
      <Sparkles className="h-10 w-10" aria-hidden="true" />
      <p className="mt-8 font-serif text-3xl">Couldn't build your digest</p>
      <p className="mt-3 max-w-xs text-center text-sm opacity-80">
        Something went wrong on our end. Give it another try.
      </p>
      <PillButton variant="secondary" onClick={onRetry} className="mt-8">
        <RotateCw className="h-4 w-4" />
        Try again
      </PillButton>
    </DigestOverlay>
  );
}
