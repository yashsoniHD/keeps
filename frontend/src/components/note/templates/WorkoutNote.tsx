import { Target, Gauge, Clock, Repeat, Dumbbell, Lightbulb, type LucideIcon } from "lucide-react";
import type { Note } from "@/lib/types";
import { noteAccent, type NoteAccent } from "@/lib/note-meta";
import { StatGrid, type Stat } from "../StatGrid";

interface Exercise {
  name: string;
  sets?: string;
  reps?: string;
  duration?: string;
  rest?: string;
  formCues?: string;
}

interface WorkoutData {
  goal?: string;
  level?: string;
  duration?: string;
  frequency?: string;
  equipment?: string[];
  structure?: { block: string; items: string[] }[];
  exercises?: Exercise[];
  tips?: string[];
}

export function WorkoutNote({ note }: { note: Note }) {
  const data = note.data as WorkoutData;
  const accent = noteAccent(note.content_type);
  const stats: Stat[] = (
    [
      { icon: Target, label: "Goal", value: data.goal },
      { icon: Gauge, label: "Level", value: data.level },
      { icon: Clock, label: "Duration", value: data.duration },
      { icon: Repeat, label: "Frequency", value: data.frequency },
    ] as { icon: LucideIcon; label: string; value?: string }[]
  ).filter((s): s is Stat => Boolean(s.value));

  return (
    <div>
      <StatGrid stats={stats} accent={accent} capitalize />

      {data.equipment && data.equipment.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Dumbbell className={`h-4 w-4 ${accent.text}`} />
          {data.equipment.map((eq, i) => (
            <span
              key={i}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs text-ink capitalize"
            >
              {eq}
            </span>
          ))}
        </div>
      )}

      {(data.structure ?? []).map((block, i) => (
        <section key={i} className="mt-8">
          <h2 className="font-serif text-2xl text-ink">{block.block}</h2>
          <ul className="mt-3 space-y-2">
            {(block.items ?? []).map((item, j) => (
              <li key={j} className="flex items-start gap-3 text-ink">
                <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {data.exercises && data.exercises.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-2xl text-ink">Exercises</h2>
          <ol className="mt-4 space-y-4">
            {data.exercises.map((ex, i) => (
              <li key={i} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-3">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium text-paper ${accent.dot}`}
                    >
                      {i + 1}
                    </span>
                    <h3 className="font-serif text-xl text-ink">{ex.name}</h3>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {ex.sets && <Pill label="Sets" value={ex.sets} accent={accent} />}
                    {ex.reps && <Pill label="Reps" value={ex.reps} accent={accent} />}
                    {ex.duration && <Pill label="Time" value={ex.duration} accent={accent} />}
                    {ex.rest && <Pill label="Rest" value={ex.rest} accent={accent} />}
                  </div>
                </div>
                {ex.formCues && <p className="mt-2 pl-10 text-sm text-ink-soft">{ex.formCues}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {data.tips && data.tips.length > 0 && (
        <section className="mt-10 rounded-2xl border border-border bg-card p-5">
          <h2 className="inline-flex items-center gap-2 font-serif text-xl text-ink">
            <Lightbulb className={`h-4 w-4 ${accent.text}`} /> Tips
          </h2>
          <ul className="mt-3 space-y-2">
            {data.tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-3 text-ink">
                <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Pill({ label, value, accent }: { label: string; value: string; accent: NoteAccent }) {
  return (
    <span className={`rounded-full px-2.5 py-1 ${accent.chip}`}>
      <span className="opacity-70">{label}</span> <strong>{value}</strong>
    </span>
  );
}
