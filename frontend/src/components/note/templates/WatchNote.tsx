import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Clapperboard, Film, Tv, Star } from "lucide-react";
import type { Note, WatchProvider } from "@/lib/types";
import { noteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// One work in an entertainment note's `data.titles[]`. camelCase fields come from Gemini
// extraction (what the source said); snake_case fields are backend TMDB enrichment (looked up:
// poster, backdrop, genres, per-region "where to watch" providers).
interface TitleEntry {
  title?: string;
  year?: string | null;
  mediaType?: "movie" | "tv" | "unknown" | string;
  creator?: string | null;
  why?: string | null;
  overview?: string | null;
  tmdb_id?: number;
  poster_url?: string | null;
  backdrop_url?: string | null;
  genres?: string[];
  providers?: WatchProvider[];
  providers_region?: string;
}

interface WatchData {
  titles?: TitleEntry[];
  listTheme?: string;
}

type Accent = ReturnType<typeof noteAccent>;

function typeLabel(t: TitleEntry): string | null {
  if (t.mediaType === "tv") return "TV series";
  if (t.mediaType === "movie") return "Film";
  return null;
}

function metaLine(t: TitleEntry): string {
  return [typeLabel(t), t.year, t.creator].filter(Boolean).join(" · ");
}

// The colored fallback shown when a title has no TMDB poster: the note's accent gradient plus a
// media-type glyph, so a coverless title still reads as a card and never leaves a broken image.
function PosterFallback({ t, accent }: { t: TitleEntry; accent: Accent }) {
  const Icon = t.mediaType === "tv" ? Tv : t.mediaType === "movie" ? Film : Clapperboard;
  return (
    <div className={`flex h-full w-full flex-col items-center justify-center gap-2 ${accent.soft}`}>
      <Icon className={`h-8 w-8 ${accent.text}`} />
      <span className="line-clamp-3 px-3 text-center font-serif text-sm text-ink">{t.title}</span>
    </div>
  );
}

// The inner visual of a poster card — shared by the link and dialog variants so both look
// identical. Poster (or accent fallback), then title + meta line beneath.
function PosterCardBody({ t, accent }: { t: TitleEntry; accent: Accent }) {
  return (
    <>
      <div
        className={`aspect-[2/3] overflow-hidden rounded-2xl border border-border bg-card ring-2 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:shadow-lg ${accent.ring}`}
      >
        {t.poster_url ? (
          <img
            src={t.poster_url}
            alt={t.title ?? ""}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <PosterFallback t={t} accent={accent} />
        )}
      </div>
      <h3 className="mt-3 line-clamp-2 font-serif text-lg leading-tight text-ink">{t.title}</h3>
      {metaLine(t) && <p className="mt-0.5 text-sm text-ink-soft">{metaLine(t)}</p>}
    </>
  );
}

// A tappable poster card. When the title resolved to a TMDB id it deep-links to the full
// watchlist detail page (deterministic doc id: `m_`/`t_` + tmdb_id); otherwise it opens the
// in-note detail dialog as a fallback (no watchlist doc exists to link to).
function PosterCard({
  t,
  accent,
  itemId,
  onOpen,
}: {
  t: TitleEntry;
  accent: Accent;
  itemId: string | null;
  onOpen: () => void;
}) {
  const cardClass = `group flex flex-col rounded-2xl text-left ${FOCUS_RING}`;
  if (itemId) {
    return (
      <Link to="/watchlist/$itemId" params={{ itemId }} className={cardClass}>
        <PosterCardBody t={t} accent={accent} />
      </Link>
    );
  }
  return (
    <button type="button" onClick={onOpen} className={cardClass}>
      <PosterCardBody t={t} accent={accent} />
    </button>
  );
}

// The watchlist doc id for a title, or null if it never resolved to a TMDB entry. Mirrors the
// backend key (services/watchlist.py `_doc_id`): tv → `t_`, everything else → `m_`.
function watchItemId(t: TitleEntry): string | null {
  if (!t.tmdb_id) return null;
  return `${t.mediaType === "tv" ? "t" : "m"}_${t.tmdb_id}`;
}

// The rich detail view: backdrop/poster hero, genres, overview, why-it-was-saved. Opens in a
// dialog only for titles with no TMDB id (which can't deep-link to a watchlist detail page).
function TitleDetail({ t, accent }: { t: TitleEntry; accent: Accent }) {
  const genres = t.genres ?? [];
  return (
    <div>
      {t.backdrop_url ? (
        <div className="relative -mx-6 -mt-6 aspect-video overflow-hidden sm:rounded-t-lg">
          <img src={t.backdrop_url} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
          {/* Top scrim so the dialog's built-in close button stays legible over bright posters. */}
          <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/40 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 flex items-end gap-4 p-5">
            {t.poster_url && (
              <img
                src={t.poster_url}
                alt=""
                className="w-20 shrink-0 rounded-xl border border-white/20 shadow-lg"
              />
            )}
            <div className="min-w-0 pb-1">
              <DialogTitle className="font-serif text-2xl leading-tight text-white">
                {t.title}
              </DialogTitle>
              {metaLine(t) && <p className="mt-1 text-sm text-white/80">{metaLine(t)}</p>}
            </div>
          </div>
        </div>
      ) : (
        <DialogTitle className="font-serif text-2xl leading-tight text-ink">
          {t.title}
          {metaLine(t) && (
            <span className="mt-1 block text-sm font-normal text-ink-soft">{metaLine(t)}</span>
          )}
        </DialogTitle>
      )}

      <div className="space-y-6 px-1 pt-6">
        {genres.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {genres.map((g, i) => (
              <span key={i} className={`rounded-full px-2.5 py-1 text-sm ${accent.chip}`}>
                {g}
              </span>
            ))}
          </div>
        )}

        {t.overview && <p className="leading-relaxed text-ink">{t.overview}</p>}

        {t.why && (
          <section className={`rounded-2xl border border-border p-4 ${accent.soft}`}>
            <h4 className="inline-flex items-center gap-2 text-sm font-medium text-ink">
              <Star className={`h-4 w-4 ${accent.text}`} /> Why it's worth watching
            </h4>
            <p className="mt-2 leading-relaxed text-ink">{t.why}</p>
          </section>
        )}
      </div>
    </div>
  );
}

// Renders an entertainment note as a grid of poster cards. Tapping a card opens a rich detail
// dialog (poster/backdrop, genres, overview, "where to watch") — no link out to TMDB.
export function WatchNote({ note }: { note: Note }) {
  const data = note.data as WatchData;
  const accent = noteAccent(note.content_type);
  const titles = (data.titles ?? []).filter((t) => t && typeof t === "object" && t.title);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const active = openIndex !== null ? titles[openIndex] : null;

  return (
    <div>
      {data.listTheme && titles.length > 1 && (
        <p className="mb-6 text-sm uppercase tracking-wider text-ink-soft">{data.listTheme}</p>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {titles.map((t, i) => (
          <PosterCard
            key={`${t.title}-${i}`}
            t={t}
            accent={accent}
            itemId={watchItemId(t)}
            onOpen={() => setOpenIndex(i)}
          />
        ))}
      </div>

      <Dialog open={openIndex !== null} onOpenChange={(o) => !o && setOpenIndex(null)}>
        <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-6 sm:max-w-lg">
          {active && <TitleDetail t={active} accent={accent} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
