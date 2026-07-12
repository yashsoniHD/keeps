import { useMemo, useState } from "react";
import { ShoppingCart, X, Share2, Eraser, Check } from "lucide-react";
import { FOCUS_RING } from "@/lib/ui";
import type { RecipeItem } from "@/lib/types";

// localStorage key for the checked-off lines, per user — so a half-shopped list survives a reload
// without any backend write. Keyed by the normalized ingredient line (see `norm`).
const checkedKey = (uid: string) => `recipe-grocery-checked:${uid}`;

// Normalize an ingredient line for de-duplication / check-tracking: lowercase + collapsed
// whitespace. We deliberately do NOT sum quantities ("2 onions" + "1 onion") — the strings are
// freeform and parsing them reliably is fragile; instead identical lines collapse and each row
// shows which recipes need it.
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

interface Row {
  line: string; // the first-seen original casing
  recipes: string[]; // recipe titles that need this line
}

function aggregate(items: RecipeItem[]): Row[] {
  const byKey = new Map<string, Row>();
  for (const item of items) {
    const seenInThisRecipe = new Set<string>();
    for (const group of item.ingredients ?? []) {
      for (const raw of group.items ?? []) {
        const key = norm(raw);
        if (!key) continue;
        const existing = byKey.get(key);
        if (existing) {
          if (!seenInThisRecipe.has(key)) existing.recipes.push(item.title);
        } else {
          byKey.set(key, { line: raw.trim(), recipes: [item.title] });
        }
        seenInThisRecipe.add(key);
      }
    }
  }
  return [...byKey.values()];
}

// A combined, checkable grocery list built from the selected recipes' structured ingredients.
// Fully client-side: aggregation is pure, and checked state lives in localStorage (no backend).
export function GroceryListSheet({
  uid,
  items,
  onClose,
}: {
  uid: string;
  items: RecipeItem[];
  onClose: () => void;
}) {
  const rows = useMemo(() => aggregate(items), [items]);
  const [checked, setChecked] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(checkedKey(uid));
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });

  const persist = (next: Set<string>) => {
    setChecked(next);
    try {
      localStorage.setItem(checkedKey(uid), JSON.stringify([...next]));
    } catch {
      /* private mode / quota — the list still works for this session */
    }
  };

  const toggle = (line: string) => {
    const key = norm(line);
    const next = new Set(checked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persist(next);
  };

  const clearChecked = () => persist(new Set());

  const share = async () => {
    // Share the still-needed (unchecked) lines as plain text.
    const text = rows
      .filter((r) => !checked.has(norm(r.line)))
      .map((r) => `• ${r.line}`)
      .join("\n");
    if (!text) return;
    const payload = { title: "Grocery list", text };
    try {
      if (navigator.share) await navigator.share(payload);
      else await navigator.clipboard.writeText(text);
    } catch {
      /* user dismissed the share sheet — nothing to do */
    }
  };

  const remaining = rows.filter((r) => !checked.has(norm(r.line))).length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <ShoppingCart className="h-4 w-4 shrink-0 text-recipe" />
          <span className="flex-1 text-sm font-medium text-ink">
            Grocery list · {remaining} to buy
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={`rounded-full p-1 text-ink-soft hover:text-ink ${FOCUS_RING}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {rows.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-ink-soft">
              These recipes have no ingredients to list.
            </p>
          ) : (
            <ul>
              {rows.map((r) => {
                const isChecked = checked.has(norm(r.line));
                return (
                  <li key={r.line}>
                    <button
                      type="button"
                      onClick={() => toggle(r.line)}
                      className={`flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-recipe-soft/40 ${FOCUS_RING}`}
                    >
                      <span
                        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                          isChecked
                            ? "border-transparent bg-recipe text-recipe-on"
                            : "border-border bg-card"
                        }`}
                      >
                        {isChecked && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block text-sm ${isChecked ? "text-ink-soft line-through" : "text-ink"}`}
                        >
                          {r.line}
                        </span>
                        {r.recipes.length > 0 && (
                          <span className="block truncate text-xs text-ink-soft">
                            {r.recipes.join(", ")}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={clearChecked}
            className={`inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink ${FOCUS_RING} rounded`}
          >
            <Eraser className="h-4 w-4" />
            Clear checked
          </button>
          <button
            type="button"
            onClick={share}
            disabled={remaining === 0}
            className={`inline-flex items-center gap-1.5 rounded-full bg-recipe px-4 py-2 text-sm font-medium text-recipe-on transition-opacity hover:opacity-90 disabled:opacity-50 ${FOCUS_RING}`}
          >
            <Share2 className="h-4 w-4" />
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
