import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  MapPin,
  CheckCircle2,
  Star,
  Trash2,
  FileText,
  Loader2,
  Clock,
  Repeat,
  Sparkles,
  Lightbulb,
  Utensils,
  Users,
} from "lucide-react";
import { watchPlaceItem, getNote } from "@/lib/firestore";
import { getPlaceItemDetails, updatePlaceItem, deletePlaceItem } from "@/lib/api";
import { paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import type { PlaceItem, PlaceItemDetails } from "@/lib/types";
import { ActionRow } from "./ActionRow";
import { PlacesMap } from "./PlacesMap";

const PLACE = paletteAccent(1);

// The venue detail page: photo hero, embedded mini-map, address & hours, region-aware actions,
// highlights/must-try/tips from the source, the star toggle (feeds the Starred tab) + Been visit
// log + personal rating + notes, and links back to the notes it came from. Live-listens to the
// item; rich Google data (hours/photo) is fetched on demand and not stored on the item.
export function PlaceDetail({
  uid,
  itemId,
  onDeleted,
}: {
  uid: string;
  itemId: string;
  onDeleted: () => void;
}) {
  const [item, setItem] = useState<PlaceItem | null | undefined>(undefined);
  const [details, setDetails] = useState<PlaceItemDetails>({});
  const [sources, setSources] = useState<{ id: string; title: string }[]>([]);
  const [notesDraft, setNotesDraft] = useState<string>("");
  const [deleting, setDeleting] = useState(false);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => watchPlaceItem(uid, itemId, setItem), [uid, itemId]);

  useEffect(() => {
    getPlaceItemDetails(itemId)
      .then(setDetails)
      .catch(() => setDetails({}));
  }, [itemId]);

  // Seed the notes textarea once when the item first loads (don't fight live updates after).
  useEffect(() => {
    if (item) setNotesDraft((prev) => (prev === "" ? (item.user_notes ?? "") : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

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
        <MapPin className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }
  if (item === null) {
    return (
      <div className="py-20 text-center text-ink-soft">
        <p className="font-medium text-ink">This place isn’t in your list.</p>
        <Link to="/places" className="mt-2 inline-block text-sm text-place hover:underline">
          Back to places
        </Link>
      </div>
    );
  }

  const visited = item.place_status === "visited";
  const favorite = !!item.favorite;
  const visitCount = item.visit_count ?? 0;
  const photo = item.photo_url ?? details.photo_url ?? null;
  const hours = item.opening_hours?.length ? item.opening_hours : (details.opening_hours ?? []);
  const summary = details.editorial_summary ?? null;

  // Marking Been (a sticky attribute) seeds the visit count; un-marking is a correction.
  const toggleVisited = () =>
    updatePlaceItem(item.id, { place_status: visited ? "saved" : "visited" }).catch(() => {});
  // Record another visit without losing history (a place is revisitable).
  const logVisit = () => updatePlaceItem(item.id, { log_visit: true }).catch(() => {});
  const toggleFavorite = () => updatePlaceItem(item.id, { favorite: !favorite }).catch(() => {});
  const rate = (n: number) => updatePlaceItem(item.id, { user_rating: n }).catch(() => {});

  const onNotesChange = (v: string) => {
    setNotesDraft(v);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      updatePlaceItem(item.id, { user_notes: v }).catch(() => {});
    }, 700);
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await deletePlaceItem(item.id);
      onDeleted();
    } catch {
      setDeleting(false);
    }
  };

  const metaBits = [item.category, item.cuisine, item.price_level, item.price_for_two].filter(
    Boolean,
  );

  return (
    <div>
      {/* Photo hero */}
      <div className="relative -mx-4 mb-6 h-44 overflow-hidden bg-place-soft sm:h-64 md:-mx-8 md:rounded-2xl">
        {photo ? (
          <img src={photo} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <MapPin className="h-12 w-12 text-place/40" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
      </div>

      <h1 className="font-serif text-2xl text-ink sm:text-3xl">{item.name}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
        {item.location && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className={`h-4 w-4 ${PLACE.text}`} />
            {item.location}
          </span>
        )}
        {metaBits.map((b, i) => (
          <span key={i}>· {b}</span>
        ))}
        {item.rating ? (
          <span className="inline-flex items-center gap-1">
            · <Star className="h-3.5 w-3.5 fill-favorite text-favorite" />
            {item.rating}
            {item.user_rating_count ? ` (${item.user_rating_count})` : ""}
          </span>
        ) : null}
      </div>

      {/* Actions */}
      <div className="mt-4">
        <ActionRow actions={item.action_links} />
      </div>

      {/* Star + your visit log */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/* Star — feeds the Starred tab; your shortlist of go-to (and must-try) spots */}
        <button
          type="button"
          onClick={toggleFavorite}
          aria-pressed={favorite}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${FOCUS_RING} ${
            favorite
              ? "border-transparent bg-favorite text-favorite-on"
              : "border-border bg-card text-ink hover:bg-place-soft"
          }`}
        >
          <Star className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} />
          {favorite ? "Starred" : "Star"}
        </button>
        <button
          type="button"
          onClick={toggleVisited}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${FOCUS_RING} ${
            visited
              ? "border-transparent bg-place text-place-on"
              : "border-border bg-card text-ink hover:bg-place-soft"
          }`}
        >
          {visited ? <CheckCircle2 className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
          {visited ? (visitCount > 1 ? `Been ${visitCount}×` : "Been") : "Mark Been"}
        </button>
        {/* A place is revisitable — log each return without overwriting history */}
        {visited && (
          <button
            type="button"
            onClick={logVisit}
            className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-place-soft ${FOCUS_RING}`}
          >
            <Repeat className="h-4 w-4" />I went again
          </button>
        )}
        {visited && (
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
                    (item.user_rating ?? 0) >= n
                      ? "fill-favorite text-favorite"
                      : "text-ink-soft/40"
                  }`}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Your notes */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-ink-soft">Your notes</h2>
        <textarea
          value={notesDraft}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={3}
          placeholder="What to order, who you went with, what you thought…"
          className={`w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-soft ${FOCUS_RING}`}
        />
      </section>

      {summary && (
        <section className="mt-6">
          <p className="text-sm leading-relaxed text-ink">{summary}</p>
        </section>
      )}

      {/* Embedded mini-map */}
      {typeof item.lat === "number" && (
        <section className="mt-6">
          <PlacesMap items={[item]} heightClass="h-56" interactive={false} />
        </section>
      )}

      {/* Opening hours */}
      {hours.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-ink-soft">
            <Clock className="h-4 w-4" /> Hours
          </h2>
          <ul className="space-y-1 text-sm text-ink">
            {hours.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Must-try */}
      {(item.must_try?.length ?? 0) > 0 && (
        <section className="mt-8">
          <h2 className="inline-flex items-center gap-2 font-serif text-xl text-ink">
            <Utensils className={`h-4 w-4 ${PLACE.text}`} /> Must try
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {item.must_try!.map((m, i) => (
              <span key={i} className={`rounded-full px-2.5 py-1 text-sm ${PLACE.chip}`}>
                {m}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Highlights */}
      {(item.highlights?.length ?? 0) > 0 && (
        <section className="mt-8">
          <h2 className="inline-flex items-center gap-2 font-serif text-2xl text-ink">
            <Sparkles className={`h-5 w-5 ${PLACE.text}`} /> Highlights
          </h2>
          <ul className="mt-4 space-y-3">
            {item.highlights!.map((h, i) => (
              <li key={i} className="flex items-start gap-3 text-ink">
                <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${PLACE.dot}`} />
                <span className="leading-relaxed">{h}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Good for */}
      {(item.good_for?.length ?? 0) > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-ink-soft">
            <Users className="h-4 w-4" /> Good for
          </h2>
          <div className="flex flex-wrap gap-2">
            {item.good_for!.map((g, i) => (
              <span
                key={i}
                className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-ink"
              >
                {g}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Tips */}
      {(item.tips?.length ?? 0) > 0 && (
        <section className="mt-8 rounded-2xl border border-border bg-card p-5">
          <h2 className="inline-flex items-center gap-2 font-serif text-xl text-ink">
            <Lightbulb className={`h-4 w-4 ${PLACE.text}`} /> Tips
          </h2>
          <ul className="mt-3 space-y-2.5">
            {item.tips!.map((t, i) => (
              <li key={i} className="flex items-start gap-3 text-ink">
                <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${PLACE.dot}`} />
                <span>{t}</span>
              </li>
            ))}
          </ul>
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
                className={`flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink transition-colors hover:bg-place-soft ${FOCUS_RING}`}
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
          Remove from places
        </button>
      </section>
    </div>
  );
}
