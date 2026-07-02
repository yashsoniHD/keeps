import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2, Plus, Check, Star } from "lucide-react";
import { searchPlaces, addPlaceItem } from "@/lib/api";
import { FOCUS_RING } from "@/lib/ui";
import type { PlaceSearchResult } from "@/lib/types";

// A venue search → add picker (Google Places). Opens over the places list; type a venue, pick a
// result, and it's added fully enriched (the parent's onSnapshot makes the new card appear live).
// Mirrors the watchlist's AddTitleSheet. Pasting a Maps/venue URL through the normal capture flow
// also works.
export function AddPlaceSheet({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        setResults(await searchPlaces(term));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [q]);

  const add = async (r: PlaceSearchResult) => {
    setAdding(r.place_id);
    try {
      await addPlaceItem({ place_id: r.place_id });
      setAdded((s) => new Set(s).add(r.place_id));
    } catch {
      // leave it un-added; the user can retry
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-background shadow-xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-soft" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search restaurants, cafés, bars…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-soft"
          />
          {searching && <Loader2 className="h-4 w-4 animate-spin text-ink-soft" />}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={`rounded-full p-1 text-ink-soft hover:text-ink ${FOCUS_RING}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {results.length === 0 && q.trim() && !searching && (
            <p className="px-4 py-8 text-center text-sm text-ink-soft">No matches.</p>
          )}
          {results.map((r) => {
            const isAdded = added.has(r.place_id);
            return (
              <div key={r.place_id} className="flex items-center gap-3 px-4 py-2 hover:bg-card">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{r.name}</p>
                  <p className="truncate text-xs text-ink-soft">
                    {[r.category, r.formatted_address].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {r.rating ? (
                  <span className="inline-flex items-center gap-0.5 text-xs text-ink-soft">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    {r.rating}
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={isAdded || adding === r.place_id}
                  onClick={() => add(r)}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${FOCUS_RING} ${
                    isAdded
                      ? "border-transparent bg-itinerary text-white"
                      : "border-border bg-card text-ink-soft hover:text-ink"
                  }`}
                  aria-label={isAdded ? "Added" : "Add to places"}
                >
                  {adding === r.place_id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isAdded ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
