import { noteAccent, noteIcon, noteLabel } from "@/lib/note-meta";

export function TypeBadge({ type, size = "sm" }: { type: string; size?: "sm" | "md" }) {
  const Icon = noteIcon(type);
  const accent = noteAccent(type);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${accent.chip} ${
        size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs"
      }`}
    >
      <Icon className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} />
      {noteLabel(type)}
    </span>
  );
}
