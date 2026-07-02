import { Clock, Timer, Flame, Users, Gauge, Globe, Zap, Lightbulb, type LucideIcon } from "lucide-react";
import type { Note } from "@/lib/types";
import { noteAccent } from "@/lib/note-meta";

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
  const accent = noteAccent(note.content_type);

  const stats: { icon: LucideIcon; label: string; value?: string }[] = [
    { icon: Clock, label: "Total", value: data.totalTime },
    { icon: Timer, label: "Prep", value: data.prepTime },
    { icon: Flame, label: "Cook", value: data.cookTime },
    { icon: Users, label: "Serves", value: data.servings },
    { icon: Gauge, label: "Effort", value: data.difficulty },
    { icon: Globe, label: "Cuisine", value: data.cuisine },
    { icon: Zap, label: "Calories", value: data.calories },
  ].filter((s) => s.value);

  // Always show something useful even when the model only gave a cook time.
  if (stats.length === 0) {
    stats.push({ icon: Clock, label: "Time", value: data.cookTime ?? "—" });
  }

  return (
    <div>
      <div
        className={`grid gap-3 rounded-2xl border border-border p-4 ${accent.soft}`}
        style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0, 1fr))` }}
      >
        {stats.map((s, i) => (
          <div key={i} className="flex flex-col items-center gap-1 text-center">
            <s.icon className={`h-4 w-4 ${accent.text}`} />
            <div className="text-xs uppercase tracking-wider text-ink-soft">{s.label}</div>
            <div className="font-serif text-lg text-ink capitalize">{s.value}</div>
          </div>
        ))}
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
                      <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
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
          <ol className="mt-4 space-y-5 border-l border-border pl-5">
            {(data.steps ?? []).map((step, i) => (
              <li key={i} className="flex gap-4 text-ink">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium text-paper ${accent.dot}`}
                >
                  {i + 1}
                </span>
                <p className="pt-0.5 leading-relaxed">{step}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

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
