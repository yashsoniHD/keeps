import { memo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { MapPin, Star } from "lucide-react-native";
import { useRouter } from "expo-router";
import type { PlaceItem } from "@clipnote/shared";
import { interopIcon, paletteAccent } from "@/lib/note-meta";

interopIcon(Star);

const PLACE_ACCENT = paletteAccent(1); // the "place" palette, shared with place notes

// "Been 3×" once you've logged more than one visit — a quiet text adornment. Port of
// frontend/src/components/places/PlaceCard.tsx visitsLabel.
function visitsLabel(item: PlaceItem): string | null {
  if (item.place_status !== "visited") return null;
  const n = item.visit_count ?? 0;
  return n > 1 ? `Been ${n}×` : "Been";
}

// One venue row in the places list. Port of frontend/src/components/places/PlaceCard.tsx as a
// horizontal row (brief calls for a "photo card list", not a grid) — photo thumbnail left, name
// + city/category/price + rating right. Lean: tap opens the detail page, where every action
// (star / Been / directions / rate / notes) lives.
export const PlaceCard = memo(function PlaceCard({ item, index }: { item: PlaceItem; index?: number }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const subtitle = [item.category, item.city].filter(Boolean).join(" · ");
  const visits = visitsLabel(item);
  const price = item.price_level || item.price_for_two;

  return (
    <Pressable
      onPress={() => router.push(`/places/${item.id}`)}
      className="flex-row items-center gap-3 rounded-2xl border border-border bg-card p-3 active:opacity-80"
    >
      <View
        className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-xl ${PLACE_ACCENT.soft}`}
      >
        <View className="absolute inset-0 items-center justify-center">
          <MapPin size={20} color="#3c7b54" style={{ opacity: 0.5 }} />
        </View>
        {item.photo_url && !failed ? (
          <Image
            source={{ uri: item.photo_url }}
            style={{ flex: 1 }}
            contentFit="cover"
            transition={150}
            onError={() => setFailed(true)}
          />
        ) : null}
        {typeof index === "number" && (
          <View className={`absolute left-1 top-1 h-4 w-4 items-center justify-center rounded-full ${PLACE_ACCENT.dot}`}>
            <Text className="text-[10px] font-semibold text-paper">{index + 1}</Text>
          </View>
        )}
      </View>

      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-sm font-medium text-ink" numberOfLines={1}>
          {item.name}
        </Text>
        {subtitle ? (
          <Text className="text-xs text-ink-soft" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        <View className="mt-0.5 flex-row items-center gap-2">
          {item.place_status === "visited" && item.user_rating ? (
            <View className="flex-row items-center gap-1">
              <Star size={12} className="text-favorite" fill="currentColor" />
              <Text className="text-xs text-ink-soft">{item.user_rating}/5 · you</Text>
            </View>
          ) : item.rating ? (
            <View className="flex-row items-center gap-1">
              <Star size={12} className="text-favorite" fill="currentColor" />
              <Text className="text-xs text-ink-soft">{item.rating}</Text>
            </View>
          ) : null}
          {price ? <Text className="text-xs text-ink-soft">{price}</Text> : null}
          {visits ? <Text className="text-xs text-place">{visits}</Text> : null}
        </View>
      </View>

      {item.favorite && (
        <View className="h-7 w-7 items-center justify-center rounded-full bg-favorite">
          <Star size={13} className="text-favorite-on" fill="currentColor" />
        </View>
      )}
    </Pressable>
  );
});
