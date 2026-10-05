import { CookingPot, Lightbulb } from "lucide-react";
import { humanize, isRec, recs, str, strs } from "../toView";
import {
  Bullets,
  Callout,
  Checklist,
  Glance,
  LabelValues,
  Section,
  Steps,
  type TemplateProps,
} from "./parts";
import { GenericNote } from "./GenericNote";

export function RecipeNote({ view, data }: TemplateProps) {
  // {group, items[]}[] is the schema; a flat string[] (older/odd notes) is one unnamed group.
  const flat = strs(data.ingredients);
  const groups = flat.length
    ? [{ name: "", items: flat }]
    : recs(data.ingredients)
        .map((g) => ({ name: str(g.group), items: strs(g.items) }))
        .filter((g) => g.items.length);
  const steps = strs(data.steps);
  if (!groups.length && !steps.length) return <GenericNote view={view} data={data} />;
  const tips = strs(data.tips);
  const nutrition = isRec(data.nutrition)
    ? Object.entries(data.nutrition)
        .map(([k, v]) => ({ label: humanize(k), value: str(v) }))
        .filter((r) => r.value)
    : [];
  return (
    <>
      <Glance facts={view.facts} />
      {groups.length > 0 && (
        <Section title="Ingredients" icon={CookingPot}>
          {groups.map((g, i) => (
            <div key={i} className="t-group">
              {groups.length > 1 && g.name && <h3 className="t-group-label">{g.name}</h3>}
              <Checklist items={g.items} />
            </div>
          ))}
        </Section>
      )}
      {steps.length > 0 && (
        <Section title="The method" className="block-steps t-method">
          <Steps items={steps} />
        </Section>
      )}
      {tips.length > 0 && (
        <Callout title="Tips" icon={Lightbulb}>
          <Bullets items={tips} />
        </Callout>
      )}
      {nutrition.length > 0 && (
        <Section title="Nutrition">
          <LabelValues rows={nutrition} />
        </Section>
      )}
    </>
  );
}
