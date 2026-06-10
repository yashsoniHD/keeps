import { Clock, Users, Flame, Lightbulb } from "lucide-react";
import type { Note } from "@/lib/types";

interface RecipeData {
  totalTime?: string;
  prepTime?: string;
  cookTime?: string;
  servings?: string;
  difficulty?: string;
  cuisine?: string;
  calories?: string;
  ingredients?: { group?: string; items: string[] }[];
  steps?: string[];
  tips?: string[];
}

export function RecipeNote({ note }: { note: Note }) {
  const data = note.data as RecipeData;
  return (
    <div>
      <div className="grid grid-cols-3 gap-3 rounded-2xl border border-border bg-recipe-soft/40 p-4">
        <Stat icon={Clock} label="Time" value={data.totalTime ?? data.cookTime ?? "—"} />
        <Stat icon={Users} label="Serves" value={data.servings ?? "—"} />
        <Stat icon={Flame} label="Effort" value={data.difficulty ?? "—"} />
      </div>

      <div className="mt-10 grid gap-10 md:grid-cols-[1fr_1.4fr]">
        <section>
          <h2 className="font-serif text-2xl text-ink">Ingredients</h2>
          <div className="mt-4 space-y-5">
            {(data.ingredients ?? []).map((group, gi) => (
              <div key={gi}>
                {group.group && (
                  <div className="mb-2 text-xs uppercase tracking-wider text-ink-soft">
                    {group.group}
                  </div>
                )}
                <ul className="space-y-2">
                  {(group.items ?? []).map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-ink">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-recipe" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-serif text-2xl text-ink">Method</h2>
          <ol className="mt-4 space-y-5">
            {(data.steps ?? []).map((step, i) => (
              <li key={i} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-recipe text-sm font-medium text-primary-foreground">
                  {i + 1}
                </span>
                <p className="pt-0.5 leading-relaxed text-ink">{step}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {data.tips && data.tips.length > 0 && (
        <section className="mt-10 rounded-2xl border border-border bg-card p-5">
          <h2 className="inline-flex items-center gap-2 font-serif text-xl text-ink">
            <Lightbulb className="h-4 w-4 text-recipe" /> Tips
          </h2>
          <ul className="mt-3 space-y-2">
            {data.tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-3 text-ink">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-recipe" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <Icon className="h-4 w-4 text-recipe" />
      <div className="text-xs uppercase tracking-wider text-ink-soft">{label}</div>
      <div className="font-serif text-lg text-ink">{value}</div>
    </div>
  );
}
