// Fallback for unknown / AI-invented shapes: the generic mapper's blocks (toView), with
// `quotes` lifted out as pull-quotes. Also the error-boundary fallback for every template.
import { KnowledgeBlock } from "../ui";
import { parseQuotes } from "../toView";
import { Glance, OutLink, PullQuotes, Section, type TemplateProps } from "./parts";

export function GenericNote({ view, data }: TemplateProps) {
  const quotes = parseQuotes(data.quotes);
  // The generic mapper renders `quotes` as a "Highlights" list; swap that one block in place.
  const qi = quotes.length
    ? view.blocks.findIndex((b) => b.heading === "Highlights" && b.items.length === quotes.length)
    : -1;
  if (!view.facts.length && !view.blocks.length) return <PlainNote view={view} />;
  return (
    <>
      <Glance facts={view.facts} />
      {view.blocks.map((b, i) =>
        i === qi ? (
          <Section key={i} title="Highlights">
            <PullQuotes quotes={quotes} />
          </Section>
        ) : (
          <KnowledgeBlock key={i} block={b} />
        ),
      )}
    </>
  );
}

// Last rung: plain strings only, can't throw on any data shape.
export function PlainNote({ view }: { view: TemplateProps["view"] }) {
  return (
    <p className="t-plain">
      Nothing more was pulled from this one.{" "}
      {view.url && (
        <OutLink href={view.url} className="t-inline-link">
          Open the original
        </OutLink>
      )}
    </p>
  );
}
