import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChefHat,
  Clock,
  Timer,
  Flame,
  Users,
  Gauge,
  Globe,
  Zap,
  Lightbulb,
  Star,
  Trash2,
  FileText,
  Loader2,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { watchRecipeItem, getNote } from "@/lib/firestore";
import { updateRecipeItem, deleteRecipeItem } from "@/lib/api";
import { paletteAccent, sourceLabel } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import type { RecipeItem } from "@/lib/types";
import { recipeDomain } from "./RecipeCard";

const RECIPE = paletteAccent(0);

// The recipe detail page: a stats grid, grouped ingredients, the numbered method and tips — the
// same layout as the RecipeNote template, driven off the recipe_item fields — plus the favorite
// toggle, a source link, and links back to the notes it came from. Live-listens to the item so the
// star reflects instantly. Like the wishlist there's no external fetch — everything is on the doc.
export function RecipeDetail({
  uid,
  itemId,
  onDeleted,
}: {
  uid: string;
  itemId: string;
  onDeleted: () => void;
}) {
  const [item, setItem] = useState<RecipeItem | null | undefined>(undefined); // undefined = loading
  const [sources, setSources] = useState<{ id: string; title: string }[]>([]);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => watchRecipeItem(uid, itemId, setItem), [uid, itemId]);

  useEffect(() => {
    const ids = item?.source_note_ids ?? [];
    if (ids.length === 0) {
      setSources([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      ids.map(async (id) => {
        const n = await getNote(id).catch(() => null);
        return n ? { id, title: n.title || "Source note" } : null;
      }),
    ).then((rows) => {
      if (!cancelled) setSources(rows.filter((r): r is { id: string; title: string } => !!r));
    });
    return () => {
      cancelled = true;
    };
  }, [item?.source_note_ids]);

  if (item === undefined) {
    return (
      <div className="flex justify-center py-20">
        <ChefHat className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }
  if (item === null) {
    return (
      <div className="py-20 text-center text-ink-soft">
        <p className="font-medium text-ink">This recipe isn’t in your cookbook.</p>
        <Link to="/recipes" className="mt-2 inline-block text-sm text-recipe hover:underline">
          Back to recipes
        </Link>
      </div>
    );
  }

  const favorite = !!item.favorite;
  const domain = recipeDomain(item);
  const toggleFavorite = () => updateRecipeItem(item.id, { favorite: !favorite }).catch(() => {});
  const remove = async () => {
    setDeleting(true);
    try {
      await deleteRecipeItem(item.id);
      onDeleted();
    } catch {
      setDeleting(false);
    }
  };

  const stats: { icon: LucideIcon; label: string; value?: string | null }[] = [
    { icon: Clock, label: "Total", value: item.total_time },
    { icon: Timer, label: "Prep", value: item.prep_time },
    { icon: Flame, label: "Cook", value: item.cook_time },
    { icon: Users, label: "Serves", value: item.servings },
    { icon: Gauge, label: "Effort", value: item.difficulty },
    { icon: Globe, label: "Cuisine", value: item.cuisine },
    { icon: Zap, label: "Calories", value: item.calories },
  ].filter((s) => s.value);

  return (
    <div>
      {/* Header: photo + title + actions */}
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="mx-auto w-44 shrink-0 sm:mx-0 sm:w-56">
          <div className={`aspect-[4/3] overflow-hidden rounded-2xl ${RECIPE.soft}`}>
            {item.image_url ? (
              <img src={item.image_url} alt={item.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <ChefHat className="h-1/4 w-1/4 text-recipe/50" />
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {item.cuisine && <p className="text-sm font-medium text-recipe">{item.cuisine}</p>}
          <h1 className="mt-1 font-serif text-2xl text-ink sm:text-3xl">{item.title}</h1>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={toggleFavorite}
              aria-pressed={favorite}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${FOCUS_RING} ${
                favorite
                  ? "border-transparent bg-favorite text-white"
                  : "border-border bg-card text-ink hover:bg-recipe-soft"
              }`}
            >
              <Star className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} />
              Favorite
            </button>
            {item.source_url && (
              <a
                href={item.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-recipe-soft ${FOCUS_RING}`}
              >
                {domain ? (
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                    alt=""
                    className="h-4 w-4 rounded-sm"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                <span className="capitalize">From {domain ? sourceLabel(domain) : "source"}</span>
                <ExternalLink className="h-3.5 w-3.5 text-ink-soft" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      {stats.length > 0 && (
        <div
          className={`mt-8 grid gap-3 rounded-2xl border border-border p-4 ${RECIPE.soft}`}
          style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0, 1fr))` }}
        >
          {stats.map((s, i) => (
            <div key={i} className="flex flex-col items-center gap-1 text-center">
              <s.icon className={`h-4 w-4 ${RECIPE.text}`} />
              <div className="text-xs uppercase tracking-wider text-ink-soft">{s.label}</div>
              <div className="font-serif text-lg capitalize text-ink">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Ingredients + method */}
      <div className="mt-10 grid gap-10 md:grid-cols-[1fr_1.4fr]">
        <section>
          <h2 className="font-serif text-2xl text-ink">Ingredients</h2>
          <div className="mt-4 space-y-5">
            {(item.ingredients ?? []).map((group, gi) => (
              <div key={gi}>
                {group.group && (
                  <div className="mb-2 text-xs uppercase tracking-wider text-ink-soft">
                    {group.group}
                  </div>
                )}
                <ul className="space-y-2">
                  {(group.items ?? []).map((ing, i) => (
                    <li key={i} className="flex items-start gap-3 text-ink">
                      <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${RECIPE.dot}`} />
                      <span>{ing}</span>
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
            {(item.steps ?? []).map((step, i) => (
              <li key={i} className="flex gap-4 text-ink">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium text-paper ${RECIPE.dot}`}
                >
                  {i + 1}
                </span>
                <p className="pt-0.5 leading-relaxed">{step}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* Tips */}
      {item.tips && item.tips.length > 0 && (
        <section className="mt-10 rounded-2xl border border-border bg-card p-5">
          <h2 className="inline-flex items-center gap-2 font-serif text-xl text-ink">
            <Lightbulb className={`h-4 w-4 ${RECIPE.text}`} /> Tips
          </h2>
          <ul className="mt-3 space-y-2">
            {item.tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-3 text-ink">
                <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${RECIPE.dot}`} />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* From your notes */}
      {sources.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">From your notes</h2>
          <div className="space-y-1.5">
            {sources.map((s) => (
              <Link
                key={s.id}
                to="/notes/$noteId"
                params={{ noteId: s.id }}
                className={`flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink transition-colors hover:bg-recipe-soft ${FOCUS_RING}`}
              >
                <FileText className="h-4 w-4 shrink-0 text-ink-soft" />
                <span className="truncate">{s.title}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Remove */}
      <section className="mt-10">
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className={`inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-destructive disabled:opacity-60 ${FOCUS_RING} rounded`}
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Remove from cookbook
        </button>
      </section>
    </div>
  );
}
