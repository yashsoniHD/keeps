import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Clapperboard,
  Tv,
  Eye,
  CheckCircle2,
  ExternalLink,
  Star,
  Trash2,
  FileText,
  Loader2,
  Plus,
} from "lucide-react";
import { watchWatchItem, getNote, getJob } from "@/lib/firestore";
import { getWatchItemDetails, updateWatchItem, deleteWatchItem } from "@/lib/api";
import { paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import type { WatchItem, WatchItemDetails } from "@/lib/types";

const MEDIA = paletteAccent(4);

function runtimeLabel(d: WatchItemDetails, item: WatchItem): string | null {
  if (item.media_type === "tv") {
    const s = d.number_of_seasons;
    if (s) return `${s} season${s === 1 ? "" : "s"}`;
    if (d.episode_run_time) return `${d.episode_run_time} min/ep`;
    return null;
  }
  if (d.runtime) {
    const h = Math.floor(d.runtime / 60);
    const m = d.runtime % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
  }
  return null;
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// The movie/show detail page: backdrop hero, overview, cast, where-to-watch, your status +
// rating, and links back to the notes it came from. Live-listens to the item so toggles persist
// visibly; rich TMDB data (cast/runtime/rating) is fetched on demand and not stored on the item.
export function MovieDetail({
  uid,
  itemId,
  onDeleted,
}: {
  uid: string;
  itemId: string;
  onDeleted: () => void;
}) {
  const [item, setItem] = useState<WatchItem | null | undefined>(undefined); // undefined = loading
  const [details, setDetails] = useState<WatchItemDetails>({});
  const [sources, setSources] = useState<{ id: string; title: string }[]>([]);
  // Recovered source link for items saved before source_url was stored on the doc.
  const [fallbackSource, setFallbackSource] = useState<{
    url: string;
    domain: string | null;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => watchWatchItem(uid, itemId, setItem), [uid, itemId]);

  useEffect(() => {
    getWatchItemDetails(itemId)
      .then(setDetails)
      .catch(() => setDetails({}));
  }, [itemId]);

  // Resolve source-note titles for the "From your notes" links (best-effort). For older items
  // that predate the stored source_url field, also recover the original captured link: from the
  // first source note that has one, else the job doc (item-only captures store a job id).
  useEffect(() => {
    const ids = item?.source_note_ids ?? [];
    setSources([]);
    setFallbackSource(null);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const notes = await Promise.all(ids.map((id) => getNote(id).catch(() => null)));
      if (cancelled) return;
      setSources(
        notes.flatMap((n, i) => (n ? [{ id: ids[i], title: n.title || "Source note" }] : [])),
      );
      if (item?.source_url) return; // the doc carries its own link — no fallback needed
      const withUrl = notes.find((n) => n?.source_url);
      if (withUrl?.source_url) {
        setFallbackSource({ url: withUrl.source_url, domain: withUrl.source_domain || null });
        return;
      }
      const job = await getJob(ids[0]).catch(() => null);
      if (!cancelled && job?.url) setFallbackSource({ url: job.url, domain: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [item?.source_note_ids, item?.source_url]);

  if (item === undefined) {
    return (
      <div className="flex justify-center py-20">
        <Clapperboard className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }
  if (item === null) {
    return (
      <div className="py-20 text-center text-ink-soft">
        <p className="font-medium text-ink">This title isn’t in your watchlist.</p>
        <Link to="/watchlist" className="mt-2 inline-block text-sm text-media hover:underline">
          Back to watchlist
        </Link>
      </div>
    );
  }

  // Legacy in-progress "watching" docs (the bucket was retired) are treated as on-watchlist:
  // not `saved`, not `watched`, so the only offered transitions are to_watch ↔ watched.
  const watched = item.watch_status === "watched";
  const saved = item.watch_status === "saved";
  const favorite = !!item.favorite;
  const Icon = item.media_type === "tv" ? Tv : Clapperboard;
  const backdrop = item.backdrop_url ?? details.backdrop_url ?? null;
  const overview = item.overview ?? details.overview ?? null;
  const genres = item.genres?.length ? item.genres : (details.genres ?? []);
  const runtime = runtimeLabel(details, item);
  // Where this title was saved from: the doc's own link, else the recovered legacy one.
  const sourceUrl = item.source_url || fallbackSource?.url || null;
  const sourceDomain =
    item.source_domain || fallbackSource?.domain || (sourceUrl ? domainOf(sourceUrl) : null);

  const toggleWatched = () =>
    updateWatchItem(item.id, {
      watch_status: watched ? "to_watch" : "watched",
    }).catch(() => {});
  const addToWatchlist = () =>
    updateWatchItem(item.id, { watch_status: "to_watch" }).catch(() => {});
  const toggleFavorite = () => updateWatchItem(item.id, { favorite: !favorite }).catch(() => {});
  const rate = (n: number) => updateWatchItem(item.id, { rating: n }).catch(() => {});
  const remove = async () => {
    setDeleting(true);
    try {
      await deleteWatchItem(item.id);
      onDeleted();
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div>
      {/* Backdrop hero */}
      <div className="relative -mx-4 mb-6 h-44 overflow-hidden bg-media-soft sm:h-64 md:-mx-8 md:rounded-2xl">
        {backdrop ? (
          <img src={backdrop} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Icon className="h-12 w-12 text-media/40" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
      </div>

      <div className="flex flex-col gap-6 sm:flex-row">
        {/* Poster */}
        <div className="mx-auto w-32 shrink-0 sm:mx-0 sm:w-44">
          <div className={`aspect-[2/3] overflow-hidden rounded-xl ${MEDIA.soft}`}>
            {item.poster_url ? (
              <img src={item.poster_url} alt={item.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Icon className="h-1/4 w-1/4 text-media/50" />
              </div>
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-2xl text-ink sm:text-3xl">{item.title}</h1>
          {details.tagline && (
            <p className="mt-1 text-sm italic text-ink-soft">{details.tagline}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
            <span>{item.media_type === "tv" ? "TV series" : "Film"}</span>
            {item.year && <span>· {item.year}</span>}
            {runtime && <span>· {runtime}</span>}
            {details.vote_average ? (
              <span className="inline-flex items-center gap-1">
                · <Star className="h-3.5 w-3.5 fill-favorite text-favorite" />
                {details.vote_average.toFixed(1)}
              </span>
            ) : null}
          </div>

          {/* Where this title was saved from. This is the captured source link (a reel, article,
              etc), so it's always a neutral "View on <domain>". */}
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-media-soft hover:text-media-chip ${FOCUS_RING}`}
            >
              <ExternalLink className="h-4 w-4" />
              View on {sourceDomain ?? "source"}
            </a>
          )}

          {genres.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {genres.map((g) => (
                <span key={g} className={`rounded-full px-2 py-0.5 text-xs ${MEDIA.chip}`}>
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* Your status + rating */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {saved && (
              <button
                type="button"
                onClick={addToWatchlist}
                className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-media-soft ${FOCUS_RING}`}
              >
                <Plus className="h-4 w-4" />
                Add to watchlist
              </button>
            )}
            <button
              type="button"
              onClick={toggleWatched}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${FOCUS_RING} ${
                watched
                  ? "border-transparent bg-media text-media-on"
                  : "border-border bg-card text-ink hover:bg-media-soft"
              }`}
            >
              {watched ? <CheckCircle2 className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {watched ? "Watched" : "Mark watched"}
            </button>
            {/* Favorite — cross-cutting ⭐ flag, independent of bucket */}
            <button
              type="button"
              onClick={toggleFavorite}
              aria-pressed={favorite}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${FOCUS_RING} ${
                favorite
                  ? "border-transparent bg-favorite text-favorite-on"
                  : "border-border bg-card text-ink hover:bg-media-soft"
              }`}
            >
              <Star className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} />
              Favorite
            </button>
            {/* Rate only what you've watched */}
            {watched && (
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`Rate ${n} of 5`}
                    onClick={() => rate(n)}
                    className={`${FOCUS_RING} rounded p-0.5`}
                  >
                    <Star
                      className={`h-5 w-5 ${
                        (item.rating ?? 0) >= n ? "fill-favorite text-favorite" : "text-ink-soft/40"
                      }`}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {overview && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-ink-soft">Overview</h2>
          <p className="text-sm leading-relaxed text-ink">{overview}</p>
        </section>
      )}

      {/* Cast */}
      {(details.cast?.length ?? 0) > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">Cast</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {details.cast!.map((c) => (
              <div key={c.name} className="w-20 shrink-0 text-center">
                <div className="h-24 w-20 overflow-hidden rounded-lg bg-media-soft">
                  {c.profile_url && (
                    <img
                      src={c.profile_url}
                      alt={c.name}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <p className="mt-1 truncate text-xs font-medium text-ink" title={c.name}>
                  {c.name}
                </p>
                {c.character && (
                  <p className="truncate text-[10px] text-ink-soft" title={c.character}>
                    {c.character}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* From your notes */}
      {sources.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">From your notes</h2>
          <div className="space-y-1.5">
            {sources.map((s) => (
              <Link
                key={s.id}
                to="/notes/$noteId"
                params={{ noteId: s.id }}
                className={`flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink transition-colors hover:bg-media-soft ${FOCUS_RING}`}
              >
                <FileText className="h-4 w-4 shrink-0 text-ink-soft" />
                <span className="truncate">{s.title}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Remove */}
      <section className="mt-10">
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className={`inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-destructive disabled:opacity-60 ${FOCUS_RING} rounded`}
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Remove from watchlist
        </button>
      </section>
    </div>
  );
}
