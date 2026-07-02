import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Clapperboard,
  Tv,
  Eye,
  CheckCircle2,
  PlayCircle,
  Star,
  Trash2,
  FileText,
  Loader2,
  Plus,
} from "lucide-react";
import { watchWatchItem, getNote } from "@/lib/firestore";
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
  const [deleting, setDeleting] = useState(false);

  useEffect(() => watchWatchItem(uid, itemId, setItem), [uid, itemId]);

  useEffect(() => {
    getWatchItemDetails(itemId)
      .then(setDetails)
      .catch(() => setDetails({}));
  }, [itemId]);

  // Resolve source-note titles for the "From your notes" links (best-effort).
  useEffect(() => {
    const ids = item?.source_note_ids ?? [];
    if (ids.length === 0) {
      setSources([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      ids.map(async (id) => {
        const n = await getNote(id).catch(() => null);
        return n ? { id, title: n.title || "Source note" } : null;
      }),
    ).then((rows) => {
      if (!cancelled) setSources(rows.filter((r): r is { id: string; title: string } => !!r));
    });
    return () => {
      cancelled = true;
    };
  }, [item?.source_note_ids]);

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

  const watched = item.watch_status === "watched";
  const saved = item.watch_status === "saved";
  const watching = item.watch_status === "watching";
  const favorite = !!item.favorite;
  const Icon = item.media_type === "tv" ? Tv : Clapperboard;
  const backdrop = item.backdrop_url ?? details.backdrop_url ?? null;
  const overview = item.overview ?? details.overview ?? null;
  const genres = item.genres?.length ? item.genres : (details.genres ?? []);
  const runtime = runtimeLabel(details, item);
  const providers = item.providers ?? [];

  const toggleWatched = () =>
    updateWatchItem(item.id, {
      watch_status: watched ? "to_watch" : "watched",
    }).catch(() => {});
  const addToWatchlist = () =>
    updateWatchItem(item.id, { watch_status: "to_watch" }).catch(() => {});
  const toggleWatching = () =>
    updateWatchItem(item.id, {
      watch_status: watching ? "to_watch" : "watching",
    }).catch(() => {});
  const toggleFavorite = () =>
    updateWatchItem(item.id, { favorite: !favorite }).catch(() => {});
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
                · <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                {details.vote_average.toFixed(1)}
              </span>
            ) : null}
          </div>

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
            {/* Start / stop watching — the in-progress bucket (handy for TV) */}
            {!saved && !watched && (
              <button
                type="button"
                onClick={toggleWatching}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${FOCUS_RING} ${
                  watching
                    ? "border-transparent bg-media text-white"
                    : "border-border bg-card text-ink hover:bg-media-soft"
                }`}
              >
                <PlayCircle className="h-4 w-4" />
                {watching ? "Watching" : "Start watching"}
              </button>
            )}
            <button
              type="button"
              onClick={toggleWatched}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${FOCUS_RING} ${
                watched
                  ? "border-transparent bg-media text-white"
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
                  ? "border-transparent bg-amber-400 text-white"
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
                        (item.rating ?? 0) >= n
                          ? "fill-amber-400 text-amber-400"
                          : "text-ink-soft/40"
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

      {/* Where to watch */}
      {providers.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">
            Where to watch{item.providers_region ? ` · ${item.providers_region}` : ""}
          </h2>
          <div className="flex flex-wrap gap-2">
            {providers.map((p) => (
              <span
                key={`${p.type}_${p.name}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-ink"
                title={`${p.name} (${p.type})`}
              >
                {p.logo_url && <img src={p.logo_url} alt="" className="h-4 w-4 rounded" />}
                {p.name}
                {p.type !== "flatrate" && <span className="text-ink-soft">· {p.type}</span>}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-soft/70">Streaming data by JustWatch</p>
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
          className={`inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-red-500 disabled:opacity-60 ${FOCUS_RING} rounded`}
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Remove from watchlist
        </button>
      </section>
    </div>
  );
}
