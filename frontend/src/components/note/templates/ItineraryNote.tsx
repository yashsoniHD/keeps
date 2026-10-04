import { MapPin, Calendar, Wallet, Sun, Lightbulb, type LucideIcon } from "lucide-react";
import type { Note, TripDay } from "@/lib/types";
import { noteAccent } from "@/lib/note-meta";
import { StatGrid, type Stat } from "../StatGrid";
import { SectionHeader } from "../SectionHeader";

interface ItineraryData {
  destination?: string;
  duration?: string;
  budget?: string;
  bestSeason?: string;
  // Old notes may carry geocoded lat/lng on stops; ignored.
  days?: TripDay[];
  tips?: string[];
}

export function ItineraryNote({ note }: { note: Note }) {
  const data = (note.data ?? {}) as ItineraryData;
  const accent = noteAccent(note.content_type);

  const stats: Stat[] = (
    [
      { icon: MapPin, label: "Where", value: data.destination },
      { icon: Calendar, label: "Duration", value: data.duration },
      { icon: Wallet, label: "Budget", value: data.budget },
      { icon: Sun, label: "Best season", value: data.bestSeason },
    ] as { icon?: LucideIcon; label: string; value?: string }[]
  ).filter((s): s is Stat => Boolean(s.value));

  return (
    <div className="space-y-10">
      <StatGrid stats={stats} accent={accent} />

      <div className="space-y-10">
        {(Array.isArray(data.days) ? data.days : []).map((day) => (
          <section key={day.day} className="relative">
            <div className="mb-5 flex items-baseline gap-3">
              <span className={`font-serif text-5xl ${accent.text}`}>
                {String(day.day).padStart(2, "0")}
              </span>
              <h2 className="font-serif text-2xl text-ink">{day.title}</h2>
            </div>

            <ol className="relative space-y-5 border-l-2 border-dashed border-border pl-6">
              {(Array.isArray(day.stops) ? day.stops : []).map((stop, i) => (
                <li key={i} className="relative">
                  <span
                    className={`absolute -left-[1.85rem] top-2 h-3 w-3 rounded-full border-2 bg-paper ${accent.border}`}
                  />
                  <div className="flex flex-wrap items-baseline gap-2">
                    {stop.time && (
                      <span className={`rounded-full px-2 py-0.5 font-mono text-xs ${accent.chip}`}>
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

      {Array.isArray(data.tips) && data.tips.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <SectionHeader icon={Lightbulb} iconClassName={accent.text}>
            Good to know
          </SectionHeader>
          <ul className="mt-3 space-y-2">
            {data.tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-3 text-ink">
                <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
