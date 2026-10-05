import {
  CalendarCheck,
  Globe,
  Instagram,
  MapPin,
  Navigation,
  Phone,
  ShoppingBag,
  Star,
  type LucideIcon,
} from "lucide-react";
import { join, recs, safeUrl, str, strs, type R } from "../toView";
import { Chips, Img, OutLink, type TemplateProps } from "./parts";
import { GenericNote } from "./GenericNote";

const ACTION_ICON: Record<string, LucideIcon> = {
  directions: Navigation,
  reserve: CalendarCheck,
  order: ShoppingBag,
  website: Globe,
  instagram: Instagram,
  call: Phone,
};
// Model/enrichment links: http(s) and tel only (OutLink re-checks at render).
const actionHref = (v: unknown) => {
  const s = str(v);
  return /^(https?:\/\/|tel:)/i.test(s) ? s : "";
};

function venue(v: R) {
  const rating =
    typeof v.rating === "number" && typeof v.user_rating_count === "number"
      ? `${v.rating} (${v.user_rating_count.toLocaleString()})`
      : str(v.rating);
  const actions = recs(v.action_links ?? v.actions)
    .map((a) => ({ label: str(a.label), url: actionHref(a.url), kind: str(a.kind) }))
    .filter((a) => a.label && a.url);
  if (!actions.length && safeUrl(v.website))
    actions.push({ label: "Website", url: safeUrl(v.website), kind: "website" });
  const phone = str(v.phone).replace(/[^\d+]/g, "");
  if (!actions.some((a) => a.kind === "call") && phone)
    actions.push({ label: "Call", url: `tel:${phone}`, kind: "call" });
  // No links at all: fall back to a Maps search (coordinates when enrichment has them).
  const name = str(v.name);
  const where = str(v.location) || str(v.formatted_address) || str(v.area);
  const lat = typeof v.lat === "number" && isFinite(v.lat) ? v.lat : null;
  const lng = typeof v.lng === "number" && isFinite(v.lng) ? v.lng : null;
  if (!actions.length && name) {
    const q =
      lat != null && lng != null ? `${lat},${lng}` : [name, where].filter(Boolean).join(", ");
    actions.push({
      label: "Directions",
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
      kind: "directions",
    });
  }
  return {
    name: str(v.name),
    photo: safeUrl(v.photo_url),
    kind: join([v.category || v.cuisine]),
    rating,
    price: str(v.priceForTwo) || str(v.priceRange) || str(v.price_level),
    where: str(v.location) || str(v.formatted_address),
    hours: str(v.timings),
    bestTime: str(v.bestTime),
    why: str(v.why),
    mustTry: strs(v.mustTry),
    goodFor: strs(v.goodFor),
    highlights: strs(v.highlights),
    tips: strs(v.tips),
    actions,
  };
}

export function PlaceNote({ view, data }: TemplateProps) {
  const real = recs(data.venues);
  // Legacy single-venue notes keep the venue's fields at the top level.
  const venues = (real.length ? real : [data])
    .map(venue)
    .filter((v) => v.name || v.why || v.where || v.highlights.length || v.actions.length);
  if (!venues.length) return <GenericNote view={view} data={data} />;
  const multi = venues.length > 1;
  const theme = str(data.listTheme);
  return (
    <>
      {multi && theme && <p className="t-eyebrow">{theme}</p>}
      <ol className="t-venues">
        {venues.map((v, i) => (
          <li key={i} className="t-card t-venue">
            <Img className="t-venue-photo" src={v.photo} alt={v.name} />
            <div className="t-card-body">
              <div className="t-card-head">
                {multi && (
                  <span className="entry-number" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                )}
                <h3>{v.name || view.title}</h3>
              </div>
              {(v.kind || v.rating || v.price) && (
                <p className="t-meta">
                  {v.kind && <span>{v.kind}</span>}
                  {v.rating && (
                    <span className="t-rating">
                      <Star size={13} strokeWidth={1.65} aria-hidden="true" />
                      <span className="sr-only">Rated </span>
                      {v.rating}
                    </span>
                  )}
                  {v.price && <span>{v.price}</span>}
                </p>
              )}
              {v.where && (
                <p className="t-meta">
                  <MapPin size={13} strokeWidth={1.65} aria-hidden="true" />
                  {v.where}
                </p>
              )}
              {v.hours && <p className="t-meta">Hours: {v.hours}</p>}
              {v.bestTime && <p className="t-meta">Best time: {v.bestTime}</p>}
              {v.why && <p className="t-why">{v.why}</p>}
              {v.mustTry.length > 0 && (
                <div className="t-sub">
                  <h4>Must try</h4>
                  <Chips items={v.mustTry} />
                </div>
              )}
              {v.highlights.length > 0 && (
                <ul className="t-plain-list">
                  {v.highlights.map((h, j) => (
                    <li key={j}>{h}</li>
                  ))}
                </ul>
              )}
              {v.tips.length > 0 && (
                <ul className="t-plain-list">
                  {v.tips.map((t, j) => (
                    <li key={j}>Tip: {t}</li>
                  ))}
                </ul>
              )}
              {v.goodFor.length > 0 && <Chips items={v.goodFor.map((g) => `Good for ${g}`)} />}
              {v.actions.length > 0 && (
                <div className="t-actions">
                  {v.actions.map((a, j) => {
                    const Ico = Object.hasOwn(ACTION_ICON, a.kind) ? ACTION_ICON[a.kind] : Globe;
                    return (
                      <OutLink key={j} href={a.url} className="t-action">
                        <Ico size={15} strokeWidth={1.65} aria-hidden="true" />
                        {a.label}
                      </OutLink>
                    );
                  })}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
