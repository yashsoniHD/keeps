import type { LucideIcon } from "lucide-react-native";

// Renders a dynamically-resolved lucide icon (e.g. from noteIcon(contentType)) through a
// prop, not a render-scoped `const Icon = …` local. Assigning noteIcon()'s result to a
// PascalCase local and rendering it trips react-hooks/static-components; passing the resolved
// component in as a prop (the same shape SectionHeader uses) is the accepted pattern.
export function Glyph({
  icon: Icon,
  size,
  color,
}: {
  icon: LucideIcon;
  size?: number;
  color?: string;
}) {
  return <Icon size={size} color={color} />;
}
