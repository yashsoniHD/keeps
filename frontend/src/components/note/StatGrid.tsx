import type { LucideIcon } from "lucide-react";
import type { NoteAccent } from "@/lib/note-meta";

// One at-a-glance fact (recipe time, trip budget, workout level, venue rating). Shared so
// every template's stat row looks and wraps identically.
export interface Stat {
  icon: LucideIcon;
  label: string;
  value: string;
}

// Column counts as literal class strings (Tailwind can't see interpolated ones). Three or
// fewer stats sit in a single row; four-plus wrap to two columns on phones so serif values
// never get crushed, then open out on larger screens.
const COLS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-5",
  6: "grid-cols-3 sm:grid-cols-6",
};

// The shared stat row: soft accent-tinted card, centered icon / label / value cells. Long
// values wrap instead of overflowing. `capitalize` is opt-in for templates whose values may
// arrive lowercased (recipe difficulty, workout level).
export function StatGrid({
  stats,
  accent,
  capitalize = false,
}: {
  stats: Stat[];
  accent: NoteAccent;
  capitalize?: boolean;
}) {
  if (stats.length === 0) return null;
  // A lone stat stretched across the whole note reads as broken; render it as a compact
  // inline pill instead of a full-width card.
  if (stats.length === 1) {
    const s = stats[0];
    return (
      <div>
        <span
          className={`inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-1.5 ${accent.soft}`}
        >
          <s.icon className={`h-4 w-4 shrink-0 ${accent.text}`} />
          <span className="text-xs uppercase tracking-wider text-ink-soft">{s.label}</span>
          <span className={`font-serif text-base text-ink ${capitalize ? "capitalize" : ""}`}>
            {s.value}
          </span>
        </span>
      </div>
    );
  }
  const cols = COLS[Math.min(stats.length, 6)] ?? "grid-cols-2 sm:grid-cols-4";
  return (
    <div className={`grid gap-3 rounded-2xl border border-border p-4 ${accent.soft} ${cols}`}>
      {stats.map((s, i) => (
        <div key={i} className="flex min-w-0 flex-col items-center gap-1 text-center">
          <s.icon className={`h-4 w-4 shrink-0 ${accent.text}`} />
          <div className="text-xs uppercase tracking-wider text-ink-soft">{s.label}</div>
          <div
            className={`break-words font-serif text-base leading-tight text-ink ${capitalize ? "capitalize" : ""}`}
          >
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}
