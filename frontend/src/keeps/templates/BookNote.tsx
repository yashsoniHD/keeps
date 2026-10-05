import { BookOpen, Users } from "lucide-react";
import { join, labelValues, str, strs } from "../toView";
import { Bullets, Callout, LabelValues, Section, type TemplateProps } from "./parts";
import { GenericNote } from "./GenericNote";

export function BookNote({ view, data }: TemplateProps) {
  const premise = str(data.premise);
  const ideas = strs(data.keyIdeas);
  const who = str(data.whoShouldRead);
  const facts = labelValues(data.facts);
  if (!premise && !ideas.length && !who && !facts.length)
    return <GenericNote view={view} data={data} />;
  const pages = str(data.pages);
  const meta = join([data.author, data.genre, data.published, pages && `${pages} pages`]);
  return (
    <>
      {meta && <p className="t-eyebrow">{meta}</p>}
      {premise && (
        <Section title="Premise">
          <p className="t-lead">{premise}</p>
        </Section>
      )}
      {facts.length > 0 && (
        <Section title="Facts">
          <LabelValues rows={facts} />
        </Section>
      )}
      {ideas.length > 0 && (
        <Section title="Key ideas" icon={BookOpen}>
          <Bullets items={ideas} />
        </Section>
      )}
      {who && (
        <Callout title="Who should read it" icon={Users}>
          <p>{who}</p>
        </Callout>
      )}
    </>
  );
}
