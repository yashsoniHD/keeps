import {
  Clock,
  Timer,
  Flame,
  Users,
  Gauge,
  Globe,
  Zap,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";
import type { Note } from "@/lib/types";
import { noteAccent } from "@/lib/note-meta";
import { StatGrid, type Stat } from "../StatGrid";

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

  // Some captures (older backfill stubs) never got their recipe extracted — `data` is empty.
  // Render a clear empty state with the source instead of blank Ingredients/Method scaffolding.
  const hasContent =
    (data.ingredients?.some((g) => (g.items?.length ?? 0) > 0) ?? false) ||
    (data.steps?.length ?? 0) > 0;
  if (!hasContent) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="text-ink">We couldn't pull the recipe details from this one.</p>
        {note.source_url && (
          <a
            href={note.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper"
          >
            <Globe className="h-4 w-4" />
            Open the source
          </a>
        )}
      </div>
    );
  }

  const stats: Stat[] = (
    [
      { icon: Clock, label: "Total", value: data.totalTime },
      { icon: Timer, label: "Prep", value: data.prepTime },
      { icon: Flame, label: "Cook", value: data.cookTime },
      { icon: Users, label: "Serves", value: data.servings },
      { icon: Gauge, label: "Effort", value: data.difficulty },
      { icon: Globe, label: "Cuisine", value: data.cuisine },
      { icon: Zap, label: "Calories", value: data.calories },
    ] as { icon: LucideIcon; label: string; value?: string }[]
  ).filter((s): s is Stat => Boolean(s.value));

  // No stats extracted: StatGrid renders nothing and the note opens straight into
  // Ingredients/Method (hasContent guarantees those exist).

  return (
    <div>
      <StatGrid stats={stats} accent={accent} capitalize />

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
