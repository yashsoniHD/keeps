import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Plane,
  MapPin,
  Calendar,
  Wallet,
  Sun,
  Lightbulb,
  Star,
  Trash2,
  FileText,
  Loader2,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { watchTripItem, getNote } from "@/lib/firestore";
import { updateTripItem, deleteTripItem } from "@/lib/api";
import { paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import type { TripItem } from "@/lib/types";
import { TripMap } from "@/components/shared/TripMap";
import { PackingList } from "@/components/shared/PackingList";

const TRIP = paletteAccent(8);

// The trip detail page: a stats grid, a map of the geocoded stops, the day-by-day timeline (the same
// layout as the ItineraryNote template, driven off the trip_item fields), tips, and a per-trip
// packing checklist — plus the favorite toggle, a source link, and links back to the notes it came
// from. Live-listens to the item so the star reflects instantly. No external fetch — everything is
// on the doc (the map coords were geocoded at fan-out).
export function TripDetail({
  uid,
  itemId,
  onDeleted,
}: {
  uid: string;
  itemId: string;
  onDeleted: () => void;
}) {
  const [item, setItem] = useState<TripItem | null | undefined>(undefined); // undefined = loading
  const [sources, setSources] = useState<{ id: string; title: string }[]>([]);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => watchTripItem(uid, itemId, setItem), [uid, itemId]);

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
        <Plane className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }
  if (item === null) {
    return (
      <div className="py-20 text-center text-ink-soft">
        <p className="font-medium text-ink">This trip isn’t in your trips.</p>
        <Link to="/trips" className="mt-2 inline-block text-sm text-trip hover:underline">
          Back to trips
        </Link>
      </div>
    );
  }

  const favorite = !!item.favorite;
  const toggleFavorite = () => updateTripItem(item.id, { favorite: !favorite }).catch(() => {});
  const remove = async () => {
    setDeleting(true);
    try {
      await deleteTripItem(item.id);
      onDeleted();
    } catch {
      setDeleting(false);
    }
  };

  const stats: { icon: LucideIcon; label: string; value?: string | null }[] = [
    { icon: MapPin, label: "Where", value: item.destination },
    { icon: Calendar, label: "Duration", value: item.duration },
    { icon: Wallet, label: "Budget", value: item.budget },
    { icon: Sun, label: "Best season", value: item.best_season },
  ].filter((s) => s.value);

  const days = item.days ?? [];

  return (
    <div>
      {/* Header: photo + title + actions */}
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="mx-auto w-44 shrink-0 sm:mx-0 sm:w-56">
          <div className={`aspect-[4/3] overflow-hidden rounded-2xl ${TRIP.soft}`}>
            {item.image_url ? (
              <img src={item.image_url} alt={item.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Plane className="h-1/4 w-1/4 text-trip/50" />
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {item.destination && <p className="text-sm font-medium text-trip">{item.destination}</p>}
          <h1 className="mt-1 font-serif text-2xl text-ink sm:text-3xl">{item.title}</h1>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={toggleFavorite}
              aria-pressed={favorite}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${FOCUS_RING} ${
                favorite
                  ? "border-transparent bg-favorite text-favorite-on"
                  : "border-border bg-card text-ink hover:bg-trip-soft"
              }`}
            >
              <Star className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} />
              Favorite
            </button>
            {item.source_url && (
              <a
                href={item.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-trip-soft ${FOCUS_RING}`}
              >
                <ExternalLink className="h-4 w-4" />
                View on {item.domain ?? "source"}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      {stats.length > 0 && (
        <div
          className={`mt-8 grid gap-3 rounded-2xl border border-border p-4 ${TRIP.soft}`}
          style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0, 1fr))` }}
        >
          {stats.map((s, i) => (
            <div key={i} className="flex flex-col items-center gap-1 text-center">
              <s.icon className={`h-4 w-4 ${TRIP.text}`} />
              <div className="text-xs uppercase tracking-wider text-ink-soft">{s.label}</div>
              <div className="font-serif text-base text-ink">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Map of the geocoded stops (null when none resolved or no Maps key) */}
      <div className="mt-8 empty:hidden">
        <TripMap days={days} />
      </div>

      {/* Day-by-day timeline */}
      <div className="mt-10 space-y-10">
        {days.map((day) => (
          <section key={day.day} className="relative">
            <div className="mb-5 flex items-baseline gap-3">
              <span className={`font-serif text-5xl ${TRIP.text}`}>
                {String(day.day).padStart(2, "0")}
              </span>
              {day.title && <h2 className="font-serif text-2xl text-ink">{day.title}</h2>}
            </div>

            <ol className="relative space-y-5 border-l-2 border-dashed border-border pl-6">
              {(day.stops ?? []).map((stop, i) => (
                <li key={i} className="relative">
                  <span
                    className={`absolute -left-[1.85rem] top-2 h-3 w-3 rounded-full border-2 bg-paper ${TRIP.border}`}
                  />
                  <div className="flex flex-wrap items-baseline gap-2">
                    {stop.time && (
                      <span className={`rounded-full px-2 py-0.5 font-mono text-xs ${TRIP.chip}`}>
                        {stop.time}
                      </span>
                    )}
                    <h3 className="font-serif text-xl text-ink">{stop.place}</h3>
                  </div>
                  {stop.note && <p className="mt-1 text-ink-soft">{stop.note}</p>}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      {/* Tips */}
      {item.tips && item.tips.length > 0 && (
        <section className="mt-10 rounded-2xl border border-border bg-card p-5">
          <h2 className="inline-flex items-center gap-2 font-serif text-xl text-ink">
            <Lightbulb className={`h-4 w-4 ${TRIP.text}`} /> Good to know
          </h2>
          <ul className="mt-3 space-y-2">
            {item.tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-3 text-ink">
                <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${TRIP.dot}`} />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Packing checklist (client-side, per trip) */}
      <PackingList storageKey={`trip-packing:${uid}:${item.id}`} />

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
                className={`flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink transition-colors hover:bg-trip-soft ${FOCUS_RING}`}
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
          Remove from trips
        </button>
      </section>
    </div>
  );
}
