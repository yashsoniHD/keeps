import { ArrowUpRight, Star } from "lucide-react";
import { labelValues, safeUrl, str, strs } from "../toView";
import { LabelValues, OutLink, Section, type TemplateProps } from "./parts";
import { GenericNote } from "./GenericNote";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export function ProductNote({ view, data }: TemplateProps) {
  const brand = str(data.brand);
  const price = str(data.price);
  const rating = str(data.rating);
  const specs = labelValues(data.specs);
  const pros = strs(data.pros);
  const cons = strs(data.cons);
  const verdict = str(data.verdict);
  if (!brand && !price && !rating && !specs.length && !pros.length && !cons.length && !verdict)
    return <GenericNote view={view} data={data} />;
  const buy = safeUrl(data.buyUrl) || safeUrl(view.url);
  return (
    <>
      <div className="t-hero">
        {brand && <span className="t-brand">{brand}</span>}
        {(price || rating) && (
          <p className="t-price-row">
            {price && <span className="t-price">{price}</span>}
            {rating && (
              <span className="t-rating">
                <Star size={15} strokeWidth={1.65} aria-hidden="true" />
                <span className="sr-only">Rated </span>
                {rating}
              </span>
            )}
          </p>
        )}
        {buy && (
          <OutLink href={buy} className="t-buy">
            View on {host(buy) || "site"}
            <ArrowUpRight size={16} strokeWidth={1.65} aria-hidden="true" />
          </OutLink>
        )}
      </div>
      {(pros.length > 0 || cons.length > 0) && (
        <div className="t-proscons">
          {pros.length > 0 && (
            <section className="t-pc t-pros">
              <h3>Pros</h3>
              <ul>
                {pros.map((p, i) => (
                  <li key={i}>
                    <span className="t-mark" aria-hidden="true">
                      ✓
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {cons.length > 0 && (
            <section className="t-pc t-cons">
              <h3>Cons</h3>
              <ul>
                {cons.map((c, i) => (
                  <li key={i}>
                    <span className="t-mark" aria-hidden="true">
                      ✗
                    </span>
                    {c}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {specs.length > 0 && (
        <Section title="Specs">
          <LabelValues rows={specs} />
        </Section>
      )}
      {verdict && (
        <blockquote className="t-verdict">
          <span>Verdict</span>
          <p>{verdict}</p>
        </blockquote>
      )}
    </>
  );
}
