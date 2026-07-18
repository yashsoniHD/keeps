import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { ChevronDown } from "lucide-react-native";
import { interopIcon } from "@/lib/note-meta";

// className styling on SVG icons requires interop registration (see note-meta).
[ChevronDown].forEach(interopIcon);

import type { CategoryGroup, Note } from "@clipnote/shared";
import { noteAccent, noteIcon } from "@/lib/note-meta";
import { ShelfCard, SHELF_CARD_WIDTH } from "./ShelfCard";

// Fixed cross-axis height for the horizontal strip so the nested FlashList lays out inside the
// vertical scroll container (a horizontal list needs a defined height). Covers 4:5 tile +
// the two-line title + source row + card padding.
const ROW_HEIGHT = 288;
const GAP = 12;

// The chip's own foreground token ("text-recipe-chip") — the WCAG-audited pairing for the
// `-soft` chip background — pulled out of the combined chip class so the icon + label can
// carry it (RN Text/SVG need the color set directly, they don't inherit it from the pill).
function chipTextClass(chip: string, fallback: string): string {
  return chip.split(" ").find((c) => c.startsWith("text-")) ?? fallback;
}

// One category shelf: an accent chip header (icon + label + count + a chevron that collapses
// the strip) above a horizontally-scrolling row of portrait tiles. Mirrors the web
// `CategoryShelf` — the chip is a pure label, the chevron is the only control, and collapse is
// per-mount UI state (not persisted).
export function Shelf({
  group,
  onDeleteNote,
}: {
  group: CategoryGroup;
  onDeleteNote?: (note: Note) => void;
}) {
  const slug = group.slugs[0];
  const accent = noteAccent(slug);
  const Icon = noteIcon(slug);
  const chipText = chipTextClass(accent.chip, accent.text);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <View className="mb-6">
      <View className="mb-3 flex-row items-center gap-2 px-5">
        <View className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 ${accent.chip}`}>
          <Icon size={14} className={chipText} />
          <Text className={`text-xs font-medium ${chipText}`} numberOfLines={1}>
            {group.label}
          </Text>
        </View>
        <Text className="text-[11px] text-ink-soft">{group.notes.length}</Text>
        <Pressable
          onPress={() => setCollapsed((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={collapsed ? `Expand ${group.label}` : `Collapse ${group.label}`}
        >
          <View style={{ transform: [{ rotate: collapsed ? "-90deg" : "0deg" }] }}>
            <ChevronDown size={16} className="text-ink-soft" />
          </View>
        </Pressable>
      </View>

      {!collapsed && (
        <FlashList
          horizontal
          data={group.notes}
          keyExtractor={(n) => n.id}
          renderItem={({ item }) => <ShelfCard note={item} onDelete={onDeleteNote} />}
          ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20 }}
          style={{ height: ROW_HEIGHT }}
        />
      )}
    </View>
  );
}

export { SHELF_CARD_WIDTH };
