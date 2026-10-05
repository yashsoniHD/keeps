import { Dumbbell, Lightbulb, Target } from "lucide-react";
import { recs, str, strs } from "../toView";
import { Bullets, Callout, Chips, Glance, Section, type TemplateProps } from "./parts";
import { GenericNote } from "./GenericNote";

export function WorkoutNote({ view, data }: TemplateProps) {
  const exercises = recs(data.exercises)
    .map((e) => ({
      name: str(e.name),
      setsReps: [str(e.sets), str(e.reps)].filter(Boolean).join(" × "),
      duration: str(e.duration),
      rest: str(e.rest),
      cue: str(e.formCues),
    }))
    .filter((e) => e.name);
  const structure = recs(data.structure)
    .map((s) => ({ title: str(s.block) || "Structure", items: strs(s.items) }))
    .filter((s) => s.items.length);
  if (!exercises.length && !structure.length) return <GenericNote view={view} data={data} />;
  const equipment = strs(data.equipment);
  const muscles = strs(data.muscles);
  const tips = strs(data.tips);
  return (
    <>
      <Glance facts={view.facts} />
      {equipment.length > 0 && (
        <Section title="Equipment">
          <Chips items={equipment} icon={Dumbbell} />
        </Section>
      )}
      {muscles.length > 0 && (
        <Section title="Muscles worked">
          <Chips items={muscles} icon={Target} />
        </Section>
      )}
      {structure.map((s, i) => (
        <Section key={i} title={s.title}>
          <Bullets items={s.items} />
        </Section>
      ))}
      {exercises.length > 0 && (
        <Section title="Exercises" icon={Dumbbell}>
          <ol className="exercise-list t-exercises">
            {exercises.map((e, i) => {
              const meta = [e.setsReps, e.duration, e.rest && `${e.rest} rest`].filter(Boolean);
              return (
                <li key={i}>
                  <span className="entry-number" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>{e.name}</h3>
                    {meta.length > 0 && (
                      <ul className="t-ex-meta">
                        {meta.map((m, j) => (
                          <li key={j}>{m}</li>
                        ))}
                      </ul>
                    )}
                    {e.cue && <p className="t-cue">{e.cue}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </Section>
      )}
      {tips.length > 0 && (
        <Callout title="Tips" icon={Lightbulb}>
          <Bullets items={tips} />
        </Callout>
      )}
    </>
  );
}
