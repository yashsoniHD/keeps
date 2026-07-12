import { MapIcon } from "lucide-react";

// Compact, jargon-free stand-in shown when a map can't render — the browser Maps key is missing,
// the loader failed, or the key was auth-rejected. Kept short (no 40vh dashed void) because the
// list / timeline / grid beside it still carries the content. Accepts an optional message so an
// empty-view state ("no mapped places yet") can reuse the same frame.
export function MapFallback({
  heightClass = "h-40",
  message = "Map couldn't load. The list below still works.",
}: {
  heightClass?: string;
  message?: string;
}) {
  return (
    <div
      className={`flex ${heightClass} flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card px-4 text-center`}
    >
      <MapIcon className="h-7 w-7 text-ink-soft/50" />
      <p className="max-w-xs text-sm text-ink-soft">{message}</p>
    </div>
  );
}
