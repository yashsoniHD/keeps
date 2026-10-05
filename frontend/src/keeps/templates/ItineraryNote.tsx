import { Lightbulb, MapPin } from "lucide-react";
import { recs, str, strs } from "../toView";
import { Bullets, Callout, Glance, OutLink, type TemplateProps } from "./parts";
import { GenericNote } from "./GenericNote";

const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);

// Coordinates when enrichment resolved the stop; otherwise a search on the place name
// (plus the trip's destination, so "Old Town" lands in the right city).
function mapsUrl(place: string, destination: string, lat: number | null, lng: number | null) {
  const q =
    lat != null && lng != null ? `${lat},${lng}` : [place, destination].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function ItineraryNote({ view, data }: TemplateProps) {
  const destination = str(data.destination);
  const days = recs(data.days)
    .map((d, i) => ({
      n: str(d.day) || String(i + 1),
      title: str(d.title),
      stops: recs(d.stops)
        .map((s) => ({
          time: str(s.time),
          place: str(s.place),
          note: str(s.note),
          lat: num(s.lat),
          lng: num(s.lng),
        }))
        .filter((s) => s.place || s.note),
    }))
    .filter((d) => d.stops.length || d.title);
  if (!days.length) return <GenericNote view={view} data={data} />;
  const tips = strs(data.tips);
  return (
    <>
      <Glance facts={view.facts} />
      {days.map((d, i) => (
        <section key={i} className="knowledge-block t-day">
          <h2>
            <span className="t-day-num">Day {d.n}</span>
            {d.title && <span className="t-day-title">{d.title}</span>}
          </h2>
          {d.stops.length > 0 && (
            <ol className="t-timeline">
              {d.stops.map((s, j) => (
                <li key={j}>
                  <span className="t-dot" aria-hidden="true" />
                  <div className="t-stop">
                    {s.time && <span className="t-time">{s.time}</span>}
                    {s.place && <h3>{s.place}</h3>}
                    {s.note && <p>{s.note}</p>}
                    {s.place && (
                      <OutLink
                        className="t-map-link"
                        href={mapsUrl(s.place, destination, s.lat, s.lng)}
                        label={`Open ${s.place} in Maps`}
                      >
                        <MapPin size={15} strokeWidth={1.65} aria-hidden="true" />
                        Open in Maps
                      </OutLink>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
      {tips.length > 0 && (
        <Callout title="Good to know" icon={Lightbulb}>
          <Bullets items={tips} />
        </Callout>
      )}
    </>
  );
}
