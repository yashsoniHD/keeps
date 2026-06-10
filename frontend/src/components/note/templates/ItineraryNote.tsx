import { MapPin, Calendar, Wallet, Lightbulb } from "lucide-react";
import type { Note } from "@/lib/types";

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
  return (
    <div>
      <div className="grid grid-cols-3 gap-3 rounded-2xl border border-border bg-itinerary-soft/40 p-4">
        <Meta icon={MapPin} label="Where" value={data.destination ?? "—"} />
        <Meta icon={Calendar} label="Duration" value={data.duration ?? "—"} />
        <Meta icon={Wallet} label="Budget" value={data.budget ?? data.bestSeason ?? "—"} />
      </div>

      <div className="mt-10 space-y-10">
        {(data.days ?? []).map((day) => (
          <section key={day.day} className="relative">
            <div className="mb-5 flex items-baseline gap-3">
              <span className="font-serif text-5xl text-itinerary">
                {String(day.day).padStart(2, "0")}
              </span>
              <h2 className="font-serif text-2xl text-ink">{day.title}</h2>
            </div>

            <ol className="relative space-y-5 border-l-2 border-dashed border-itinerary/30 pl-6">
              {(day.stops ?? []).map((stop, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[1.85rem] top-2 h-3 w-3 rounded-full border-2 border-itinerary bg-paper" />
                  <div className="flex flex-wrap items-baseline gap-2">
                    {stop.time && <span className="font-mono text-xs text-itinerary">{stop.time}</span>}
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
            <Lightbulb className="h-4 w-4 text-itinerary" /> Good to know
          </h2>
          <ul className="mt-3 space-y-2">
            {data.tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-3 text-ink">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-itinerary" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Meta({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <Icon className="h-4 w-4 text-itinerary" />
      <div className="text-xs uppercase tracking-wider text-ink-soft">{label}</div>
      <div className="font-serif text-base text-ink">{value}</div>
    </div>
  );
}
