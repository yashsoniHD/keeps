import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { ChevronLeft, Clapperboard, Star } from "lucide-react-native";
import type { WatchItem } from "@clipnote/shared";
import { interopIcon } from "@/lib/note-meta";
import { watchWatchItems } from "@/lib/firestore";
import { updateWatchItem, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { WatchCard } from "@/components/watchlist/WatchCard";

[ChevronLeft, Clapperboard, Star].forEach(interopIcon);

type Queue = "saved" | "to_watch" | "watched";

// Legacy in-progress "watching" docs (the bucket was retired on web) display as on-watchlist.
// Mirrors frontend/src/components/watchlist/WatchlistView.tsx bucketOf.
const bucketOf = (i: WatchItem): Queue => (i.watch_status === "watching" ? "to_watch" : i.watch_status);

const TABS: { key: Queue; label: string }[] = [
  { key: "saved", label: "Saved" },
  { key: "to_watch", label: "Watchlist" },
  { key: "watched", label: "Watched" },
];

const STATUS_LABEL: Record<Queue, string> = {
  saved: "Saved",
  to_watch: "Watchlist",
  watched: "Watched",
};

// The Watchlist mini-app: a live poster grid split into Saved (auto-captured inbox) /
// Watchlist (explicitly queued) / Watched, plus a cross-cutting Favorites filter. Trimmed from
// the web's WatchlistView for a phone: no dedupe/marquee/sort/media-filter/search-add (v1 —
// see Known gaps in the report), just the buckets + posters + status editing.
export default function WatchlistScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<WatchItem[] | null>(null);
  const [queue, setQueue] = useState<Queue>("saved");
  const [favOnly, setFavOnly] = useState(false);

  useEffect(() => {
    if (!user) return;
    return watchWatchItems(user.uid, setItems);
  }, [user]);

  const patchLocal = useCallback(
    (id: string, patch: Partial<WatchItem>) =>
      setItems((prev) => prev?.map((i) => (i.id === id ? { ...i, ...patch } : i)) ?? prev),
    [],
  );

  const setStatus = useCallback(
    async (item: WatchItem, status: WatchItem["watch_status"]) => {
      const prevStatus = item.watch_status;
      patchLocal(item.id, { watch_status: status });
      try {
        await updateWatchItem(item.id, { watch_status: status });
      } catch (err) {
        patchLocal(item.id, { watch_status: prevStatus }); // revert on failure
        Alert.alert("Couldn't update", err instanceof ApiError ? err.message : "Please try again.");
      }
    },
    [patchLocal],
  );

  const toggleFavorite = useCallback(
    async (item: WatchItem) => {
      const next = !item.favorite;
      patchLocal(item.id, { favorite: next });
      try {
        await updateWatchItem(item.id, { favorite: next });
      } catch (err) {
        patchLocal(item.id, { favorite: item.favorite }); // revert on failure
        Alert.alert("Couldn't update", err instanceof ApiError ? err.message : "Please try again.");
      }
    },
    [patchLocal],
  );

  // Long-press action sheet: jump straight to any bucket + toggle favorite, without opening
  // the detail page (the "match web interaction where portable" ask — web has no long-press
  // equivalent, so this is the phone's fast path onto the same updateWatchItem writes the
  // detail screen uses).
  const onLongPress = useCallback(
    (item: WatchItem) => {
      const buttons: Parameters<typeof Alert.alert>[2] = TABS.filter(
        (t) => bucketOf(item) !== t.key,
      ).map((t) => ({
        text: `Move to ${t.label}`,
        onPress: () => setStatus(item, t.key),
      }));
      buttons.push({
        text: item.favorite ? "Remove from favorites" : "Add to favorites",
        onPress: () => toggleFavorite(item),
      });
      buttons.push({ text: "Cancel", style: "cancel" });
      Alert.alert(item.title, undefined, buttons);
    },
    [setStatus, toggleFavorite],
  );

  const counts = useMemo(() => {
    const list = items ?? [];
    return {
      saved: list.filter((i) => bucketOf(i) === "saved").length,
      to_watch: list.filter((i) => bucketOf(i) === "to_watch").length,
      watched: list.filter((i) => bucketOf(i) === "watched").length,
    };
  }, [items]);

  const favCount = useMemo(() => (items ?? []).filter((i) => i.favorite).length, [items]);

  const shown = useMemo(() => {
    const list = items ?? [];
    return favOnly ? list.filter((i) => i.favorite) : list.filter((i) => bucketOf(i) === queue);
  }, [items, favOnly, queue]);

  if (!user) return null;

  return (
    <View className="flex-1 bg-paper">
      <SafeAreaView className="flex-1" edges={["top"]}>
        <View className="flex-row items-center gap-2 px-4 py-2">
          <Pressable
            accessibilityLabel="Back"
            onPress={() => router.back()}
            className="h-10 w-10 items-center justify-center active:opacity-60"
          >
            <ChevronLeft size={24} className="text-ink" />
          </Pressable>
          <Text className="font-serif text-2xl text-ink">Watchlist</Text>
        </View>

        {/* Queue tabs + favorites toggle */}
        <View className="flex-row items-center justify-between gap-2 px-4 pb-3">
          <View className="flex-row rounded-full border border-border bg-card p-0.5">
            {TABS.map((t) => {
              const active = !favOnly && queue === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => {
                    setQueue(t.key);
                    setFavOnly(false);
                  }}
                  className={`rounded-full px-3 py-1.5 ${active ? "bg-media" : ""}`}
                >
                  <Text
                    className={`text-xs font-medium ${active ? "text-media-on" : "text-ink-soft"}`}
                  >
                    {t.label} · {counts[t.key]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {favCount > 0 && (
            <Pressable
              onPress={() => setFavOnly((v) => !v)}
              accessibilityLabel="Favorites"
              className={`h-9 w-9 items-center justify-center rounded-full border ${
                favOnly ? "border-transparent bg-favorite" : "border-border bg-card"
              }`}
            >
              <Star
                size={16}
                className={favOnly ? "text-favorite-on" : "text-ink-soft"}
                fill={favOnly ? "currentColor" : "transparent"}
              />
            </Pressable>
          )}
        </View>

        {items === null ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : shown.length > 0 ? (
          <FlashList
            data={shown}
            keyExtractor={(i) => i.id}
            numColumns={3}
            renderItem={({ item }) => (
              <View className="w-1/3 p-1.5">
                <WatchCard item={item} onLongPress={onLongPress} />
              </View>
            )}
            contentContainerStyle={{ paddingBottom: 40 }}
          />
        ) : (
          <View className="flex-1 items-center justify-center gap-3 px-8">
            <Clapperboard size={40} className="text-ink-soft/50" strokeWidth={1.5} />
            <Text className="text-center text-base font-medium text-ink">
              {favOnly ? "No favorites yet" : `Nothing in ${STATUS_LABEL[queue]} yet`}
            </Text>
            <Text className="text-center text-sm text-ink-soft">
              {favOnly
                ? "Star a title on its detail page to keep it here."
                : "Save a link with a movie or show and it lands here."}
            </Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}
