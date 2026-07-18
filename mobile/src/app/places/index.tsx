import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, type LayoutChangeEvent, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { ChevronLeft, List, MapPin, Map as MapIcon, Star } from "lucide-react-native";
import type { PlaceItem } from "@clipnote/shared";
import { interopIcon } from "@/lib/note-meta";
import { watchPlaceItems } from "@/lib/firestore";
import { useAuth } from "@/contexts/auth-context";
import { MapView, type MapPin as Pin } from "@/components/shared/MapView";
import { PlaceCard } from "@/components/places/PlaceCard";

[ChevronLeft, List, MapPin, MapIcon, Star].forEach(interopIcon);

type Bucket = "saved" | "to_visit" | "visited";

const TABS: { key: Bucket; label: string }[] = [
  { key: "saved", label: "Saved" },
  { key: "to_visit", label: "To visit" },
  { key: "visited", label: "Visited" },
];

const STATUS_LABEL: Record<Bucket, string> = {
  saved: "Saved",
  to_visit: "To visit",
  visited: "Visited",
};

const PLACE_PIN_COLOR = "#3c7b54"; // mirrors frontend/src/lib/map-colors.ts VENUE_PIN_COLOR

// The Places mini-app: a live venue list split into Saved / To-visit / Visited, a cross-cutting
// Favorites filter, and a List/Map toggle (numbered pins matching the list order). Trimmed from
// the web's PlacesView for a phone: no dedupe/city-category filters/sort/search-add (v1 — see
// Known gaps in the report).
export default function PlacesScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<PlaceItem[] | null>(null);
  const [bucket, setBucket] = useState<Bucket>("saved");
  const [favOnly, setFavOnly] = useState(false);
  const [mapView, setMapView] = useState(false);
  // MapView takes a fixed pixel height (the map engine can't fill a flex parent), so measure
  // the available space once the map's container lays out.
  const [mapHeight, setMapHeight] = useState(0);
  const onMapAreaLayout = useCallback((e: LayoutChangeEvent) => setMapHeight(e.nativeEvent.layout.height), []);

  useEffect(() => {
    if (!user) return;
    return watchPlaceItems(user.uid, setItems);
  }, [user]);

  const counts = useMemo(() => {
    const list = items ?? [];
    return {
      saved: list.filter((i) => i.place_status === "saved").length,
      to_visit: list.filter((i) => i.place_status === "to_visit").length,
      visited: list.filter((i) => i.place_status === "visited").length,
    };
  }, [items]);

  const favCount = useMemo(() => (items ?? []).filter((i) => i.favorite).length, [items]);

  const shown = useMemo(() => {
    const list = items ?? [];
    return favOnly ? list.filter((i) => i.favorite) : list.filter((i) => i.place_status === bucket);
  }, [items, favOnly, bucket]);

  const pins = useMemo<Pin[]>(() => {
    const out: Pin[] = [];
    shown.forEach((i, idx) => {
      if (typeof i.lat !== "number" || typeof i.lng !== "number") return;
      out.push({
        lat: i.lat,
        lng: i.lng,
        label: String(idx + 1),
        color: PLACE_PIN_COLOR,
        title: i.name,
        subtitle: [i.category, i.city].filter(Boolean).join(" · ") || undefined,
      });
    });
    return out;
  }, [shown]);

  const renderIndex = useCallback(
    (id: string) => shown.findIndex((i) => i.id === id),
    [shown],
  );

  if (!user) return null;

  return (
    <View className="flex-1 bg-paper">
      <SafeAreaView className="flex-1" edges={["top"]}>
        <View className="flex-row items-center justify-between gap-2 px-4 py-2">
          <View className="flex-row items-center gap-2">
            <Pressable
              accessibilityLabel="Back"
              onPress={() => router.back()}
              className="h-10 w-10 items-center justify-center active:opacity-60"
            >
              <ChevronLeft size={24} className="text-ink" />
            </Pressable>
            <Text className="font-serif text-2xl text-ink">Places</Text>
          </View>
          <Pressable
            accessibilityLabel={mapView ? "Show list" : "Show map"}
            onPress={() => setMapView((v) => !v)}
            className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:opacity-70"
          >
            {mapView ? (
              <List size={18} className="text-ink" />
            ) : (
              <MapIcon size={18} className="text-ink" />
            )}
          </Pressable>
        </View>

        {/* Bucket tabs + favorites toggle */}
        <View className="flex-row items-center justify-between gap-2 px-4 pb-3">
          <View className="flex-row rounded-full border border-border bg-card p-0.5">
            {TABS.map((t) => {
              const active = !favOnly && bucket === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => {
                    setBucket(t.key);
                    setFavOnly(false);
                  }}
                  className={`rounded-full px-3 py-1.5 ${active ? "bg-place" : ""}`}
                >
                  <Text className={`text-xs font-medium ${active ? "text-place-on" : "text-ink-soft"}`}>
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
        ) : shown.length === 0 ? (
          <View className="flex-1 items-center justify-center gap-3 px-8">
            <MapPin size={40} className="text-ink-soft/50" strokeWidth={1.5} />
            <Text className="text-center text-base font-medium text-ink">
              {favOnly ? "No favorites yet" : `Nothing in ${STATUS_LABEL[bucket]} yet`}
            </Text>
            <Text className="text-center text-sm text-ink-soft">
              {favOnly
                ? "Star a place on its detail page to keep it here."
                : "Save a link about a restaurant, café or bar and it lands here."}
            </Text>
          </View>
        ) : mapView ? (
          <View className="flex-1 px-4 pb-4" onLayout={onMapAreaLayout}>
            {pins.length > 0 ? (
              mapHeight > 0 && <MapView pins={pins} height={mapHeight} />
            ) : (
              <Text className="mt-4 text-center text-sm text-ink-soft">
                None of these places have a location yet.
              </Text>
            )}
          </View>
        ) : (
          <FlashList
            data={shown}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => (
              <View className="px-4 pb-2.5">
                <PlaceCard item={item} index={renderIndex(item.id)} />
              </View>
            )}
            contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
          />
        )}
      </SafeAreaView>
    </View>
  );
}
