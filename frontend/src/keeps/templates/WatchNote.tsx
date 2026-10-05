import { Clapperboard, Film, Tv } from "lucide-react";
import { join, recs, safeUrl, str, strs } from "../toView";
import { Chips, Img, type TemplateProps } from "./parts";
import { GenericNote } from "./GenericNote";

const GROUPS: [type: string, label: string][] = [
  ["flatrate", "Stream"],
  ["rent", "Rent"],
  ["buy", "Buy"],
];

function providers(v: unknown) {
  const out = GROUPS.map(([, label]) => ({
    label,
    items: [] as { name: string; logo: string }[],
  }));
  for (const p of recs(v)) {
    const name = str(p.name);
    if (!name) continue;
    const gi = Math.max(
      0,
      GROUPS.findIndex(([t]) => t === str(p.type)),
    ); // unknown type -> Stream
    if (!out[gi].items.some((x) => x.name === name))
      out[gi].items.push({ name, logo: safeUrl(p.logo_url) });
  }
  return out.filter((g) => g.items.length);
}

export function WatchNote({ view, data }: TemplateProps) {
  const titles = recs(data.titles)
    .map((t) => ({
      title: str(t.title),
      mediaType: str(t.mediaType),
      meta: join([
        t.mediaType === "tv" ? "TV series" : t.mediaType === "movie" ? "Film" : "",
        t.year,
        t.creator,
      ]),
      poster: safeUrl(t.poster_url),
      genres: strs(t.genres),
      overview: str(t.overview),
      why: str(t.why),
      providers: providers(t.providers),
    }))
    .filter((t) => t.title);
  if (!titles.length) return <GenericNote view={view} data={data} />;
  const theme = str(data.listTheme);
  return (
    <>
      {titles.length > 1 && theme && <p className="t-eyebrow">{theme}</p>}
      <ol className="t-titles">
        {titles.map((t, i) => {
          const Glyph = t.mediaType === "tv" ? Tv : t.mediaType === "movie" ? Film : Clapperboard;
          return (
            <li key={i} className="t-card t-title">
              <div className="t-title-top">
                <div className="t-poster">
                  <Glyph size={26} strokeWidth={1.5} aria-hidden="true" />
                  <Img src={t.poster} alt={`${t.title} poster`} />
                </div>
                <div className="t-title-head">
                  <h3>{t.title}</h3>
                  {t.meta && <p className="t-meta">{t.meta}</p>}
                  <Chips items={t.genres} />
                </div>
              </div>
              {t.overview && <p className="t-overview">{t.overview}</p>}
              {t.why && (
                <p className="t-why">
                  <strong>Why watch: </strong>
                  {t.why}
                </p>
              )}
              {t.providers.length > 0 && (
                <div className="t-providers">
                  <h4>Where to watch</h4>
                  {t.providers.map((g) => (
                    <div key={g.label} className="t-provider-row">
                      <span className="t-provider-label">{g.label}</span>
                      <ul>
                        {g.items.map((p) => (
                          <li key={p.name} title={p.name}>
                            {p.logo ? (
                              <img src={p.logo} alt={p.name} loading="lazy" />
                            ) : (
                              <span className="t-provider-name">{p.name}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {/* Mandatory TMDB/JustWatch attribution wherever providers render. */}
                  <small className="block-credit">Streaming data by JustWatch</small>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
