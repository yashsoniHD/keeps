import { memo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { Clapperboard, Star, Tv } from "lucide-react-native";
import { useRouter } from "expo-router";
import type { WatchItem } from "@clipnote/shared";
import { interopIcon, paletteAccent } from "@/lib/note-meta";

interopIcon(Star);

const MEDIA_ACCENT = paletteAccent(4); // the "media" palette, shared with entertainment notes

// One poster tile in the watchlist grid. Port of frontend/src/components/watchlist/WatchCard.tsx,
// trimmed for touch: no overlay action buttons (that overloads a small poster on a phone) — tap
// opens the detail page, long-press opens a status/favorite action sheet (see index.tsx).
export const WatchCard = memo(function WatchCard({
  item,
  onLongPress,
}: {
  item: WatchItem;
  onLongPress: (item: WatchItem) => void;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const Icon = item.media_type === "tv" ? Tv : Clapperboard;
  const watched = item.watch_status === "watched";

  return (
    <Pressable
      onPress={() => router.push(`/watchlist/${item.id}`)}
      onLongPress={() => onLongPress(item)}
      className="min-w-0 flex-1 gap-1.5 active:opacity-80"
    >
      <View
        className={`relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-border ${MEDIA_ACCENT.soft}`}
      >
        <View className="absolute inset-0 items-center justify-center">
          <Icon size={32} color="#993f94" style={{ opacity: 0.5 }} />
        </View>
        {item.poster_url && !failed ? (
          <Image
            source={{ uri: item.poster_url }}
            style={{ flex: 1 }}
            contentFit="cover"
            transition={150}
            onError={() => setFailed(true)}
          />
        ) : null}
        {item.favorite && (
          <View className="absolute right-1.5 top-1.5 h-6 w-6 items-center justify-center rounded-full bg-favorite">
            <Star size={12} className="text-favorite-on" fill="currentColor" />
          </View>
        )}
        {watched && (
          <View className="absolute left-1.5 top-1.5 rounded-full bg-media px-2 py-0.5">
            <Text className="text-[10px] font-medium text-media-on">Watched</Text>
          </View>
        )}
      </View>
      <View className="min-w-0">
        <Text className="text-sm font-medium text-ink" numberOfLines={1}>
          {item.title}
        </Text>
        {(item.year || watched) && (
          <Text className="text-xs text-ink-soft" numberOfLines={1}>
            {watched && item.rating ? `★ ${item.rating}/5` : item.year || ""}
          </Text>
        )}
      </View>
    </Pressable>
  );
});
