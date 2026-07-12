import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2, Plus, Check } from "lucide-react";
import { searchWatchTitles, addWatchItem } from "@/lib/api";
import { FOCUS_RING } from "@/lib/ui";
import type { TmdbSearchResult } from "@/lib/types";

// A title search → add picker. Opens over the watchlist; type a title, pick a TMDB result, and
// it's added fully enriched (the parent's onSnapshot makes the new card appear live).
export function AddTitleSheet({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search as the user types.
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        setResults(await searchWatchTitles(term));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [q]);

  const add = async (r: TmdbSearchResult) => {
    setAdding(r.tmdb_id);
    try {
      await addWatchItem({ tmdb_id: r.tmdb_id, media_type: r.media_type });
      setAdded((s) => new Set(s).add(r.tmdb_id));
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
            placeholder="Search movies & shows…"
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
            const isAdded = added.has(r.tmdb_id);
            return (
              <div
                key={`${r.media_type}_${r.tmdb_id}`}
                className="flex items-center gap-3 px-4 py-2 hover:bg-card"
              >
                <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-media-soft">
                  {r.poster_url && (
                    <img
                      src={r.poster_url}
                      alt={r.title}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{r.title}</p>
                  <p className="text-xs text-ink-soft">
                    {r.media_type === "tv" ? "TV" : "Film"}
                    {r.year ? ` · ${r.year}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isAdded || adding === r.tmdb_id}
                  onClick={() => add(r)}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${FOCUS_RING} ${
                    isAdded
                      ? "border-transparent bg-media text-media-on"
                      : "border-border bg-card text-ink-soft hover:text-ink"
                  }`}
                  aria-label={isAdded ? "Added" : "Add to watchlist"}
                >
                  {adding === r.tmdb_id ? (
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
