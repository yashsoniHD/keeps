import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// The shared section heading for note templates: an optional accent-tinted lucide icon beside
// a serif h2. Replaces the hand-rolled `font-serif text-xl/2xl` + inline-icon headers that had
// drifted across the templates, so every "Ingredients" / "Highlights" / "On the map" reads the
// same. The caller tints the icon (`iconClassName={accent.text}`) to keep each template's colour.
export function SectionHeader({
  icon: Icon,
  children,
  iconClassName = "",
  className = "",
}: {
  icon?: LucideIcon;
  children: ReactNode;
  iconClassName?: string;
  className?: string;
}) {
  return (
    <h2
      className={`inline-flex items-center gap-2 font-serif text-xl text-ink md:text-2xl ${className}`}
    >
      {Icon && <Icon className={`h-5 w-5 shrink-0 ${iconClassName}`} />}
      {children}
    </h2>
  );
}
