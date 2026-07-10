import { MapPin, CalendarCheck, ShoppingBag, Phone, Globe, Instagram } from "lucide-react";
import { FOCUS_RING } from "@/lib/ui";
import type { PlaceAction } from "@/lib/types";

const ICON: Record<PlaceAction["kind"], typeof MapPin> = {
  directions: MapPin,
  reserve: CalendarCheck,
  order: ShoppingBag,
  call: Phone,
  website: Globe,
  instagram: Instagram,
};

// The region-aware action row on an enriched venue (Directions / Reserve / Order / Call /
// Website / Instagram). The backend builds the links into `data.venues[].action_links`; this
// just renders them. `compact` shows icons only (map info windows); otherwise icon + label.
// Clicks don't bubble so the row works inside a card that's also a link.
// Order / Reserve are intentionally not surfaced — venues render Directions / Call / Website /
// Instagram only. Filtered here so existing enriched notes drop them without a data migration.
const HIDDEN_KINDS = new Set<PlaceAction["kind"]>(["order", "reserve"]);

export function ActionRow({
  actions,
  compact = false,
}: {
  actions?: PlaceAction[];
  compact?: boolean;
}) {
  const shown = actions?.filter((a) => !HIDDEN_KINDS.has(a.kind)) ?? [];
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((a) => {
        const Icon = ICON[a.kind] ?? Globe;
        return (
          <a
            key={a.kind + a.url}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            title={a.label}
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-xs text-ink-soft transition-colors hover:bg-place-soft hover:text-ink ${FOCUS_RING}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {!compact && <span>{a.label}</span>}
          </a>
        );
      })}
    </div>
  );
}
