import { MapPin, Calendar, Wallet, Sun, Lightbulb, type LucideIcon } from "lucide-react";
import type { Note } from "@/lib/types";
import { noteAccent } from "@/lib/note-meta";

interface ItineraryData {
  destination?: string;
  duration?: string;
  budget?: string;
  bestSeason?: string;
  days?: { day: number; title?: string; stops?: { time?: string; place: string; note?: string }[] }[];
  tips?: string[];
}

export function ItineraryNote({ note }: { note: Note }) {
  const data = note.data as ItineraryData;
  const accent = noteAccent(note.content_type);

  const stats: { icon: LucideIcon; label: string; value?: string }[] = [
    { icon: MapPin, label: "Where", value: data.destination },
    { icon: Calendar, label: "Duration", value: data.duration },
    { icon: Wallet, label: "Budget", value: data.budget },
    { icon: Sun, label: "Best season", value: data.bestSeason },
  ].filter((s) => s.value);

  return (
    <div>
      {stats.length > 0 && (
        <div
          className={`grid gap-3 rounded-2xl border border-border p-4 ${accent.soft}`}
          style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0, 1fr))` }}
        >
          {stats.map((s, i) => (
            <div key={i} className="flex flex-col items-center gap-1 text-center">
              <s.icon className={`h-4 w-4 ${accent.text}`} />
              <div className="text-xs uppercase tracking-wider text-ink-soft">{s.label}</div>
              <div className="font-serif text-base text-ink">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-10 space-y-10">
        {(data.days ?? []).map((day) => (
          <section key={day.day} className="relative">
            <div className="mb-5 flex items-baseline gap-3">
              <span className={`font-serif text-5xl ${accent.text}`}>
                {String(day.day).padStart(2, "0")}
              </span>
              <h2 className="font-serif text-2xl text-ink">{day.title}</h2>
            </div>

            <ol className="relative space-y-5 border-l-2 border-dashed border-border pl-6">
              {(day.stops ?? []).map((stop, i) => (
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

      {data.tips && data.tips.length > 0 && (
        <section className="mt-10 rounded-2xl border border-border bg-card p-5">
          <h2 className="inline-flex items-center gap-2 font-serif text-xl text-ink">
            <Lightbulb className={`h-4 w-4 ${accent.text}`} /> Good to know
          </h2>
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
