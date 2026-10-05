import { Clock, ListChecks, Play, Quote } from "lucide-react";
import { labelValues, parseQuotes, str, strs } from "../toView";
import { Checklist, LabelValues, PullQuotes, Section, type TemplateProps } from "./parts";
import { GenericNote } from "./GenericNote";

export function SummaryNote({ view, data }: TemplateProps) {
  const tldr = str(data.tldr);
  const facts = labelValues(data.facts);
  const points = strs(data.keyPoints);
  const quotes = parseQuotes(data.quotes);
  const actions = strs(data.actionItems);
  if (!tldr && !facts.length && !points.length && !quotes.length && !actions.length)
    return <GenericNote view={view} data={data} />;

  const medium = str(data.medium);
  const isVideo = medium === "video";
  const length = isVideo ? str(data.videoLength) : str(data.readTime);
  const MediumIcon = isVideo ? Play : Clock;
  return (
    <>
      {(medium || length) && (
        <p className="t-eyebrow">
          <MediumIcon size={14} strokeWidth={1.65} aria-hidden="true" />
          {[isVideo ? "Video" : medium || "Article", length].filter(Boolean).join(" · ")}
        </p>
      )}
      {tldr && tldr !== view.summary && (
        <Section title="TL;DR">
          <p className="t-lead">{tldr}</p>
        </Section>
      )}
      {facts.length > 0 && (
        <Section title="Facts">
          <LabelValues rows={facts} />
        </Section>
      )}
      {points.length > 0 && (
        <Section title="Key points">
          <ol className="t-numbered">
            {points.map((p, i) => (
              <li key={i}>
                <span className="t-num" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
      {quotes.length > 0 && (
        <Section title="Highlights" icon={Quote}>
          <PullQuotes quotes={quotes} />
        </Section>
      )}
      {actions.length > 0 && (
        <Section title="Action items" icon={ListChecks}>
          <Checklist items={actions} />
        </Section>
      )}
    </>
  );
}
