import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  CalendarCheck,
  Camera,
  ChevronDown,
  ChevronLeft,
  Clock,
  FileText,
  Globe,
  Lightbulb,
  MapPin,
  Phone,
  Repeat,
  ShoppingBag,
  Sparkles,
  Star,
  Trash2,
  Users,
  Utensils,
  type LucideIcon,
} from "lucide-react-native";
import type { Note, PlaceAction, PlaceItem, PlaceItemDetails } from "@clipnote/shared";
import { interopIcon, paletteAccent } from "@/lib/note-meta";
import { getNote, watchPlaceItem } from "@/lib/firestore";
import { deletePlaceItem, getPlaceItemDetails, updatePlaceItem, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { useTokens } from "@/components/note/colors";
import { MapView } from "@/components/shared/MapView";

[
  CalendarCheck,
  Camera,
  ChevronDown,
  ChevronLeft,
  Clock,
  FileText,
  Globe,
  Lightbulb,
  MapPin,
  Phone,
  Repeat,
  ShoppingBag,
  Sparkles,
  Star,
  Trash2,
  Users,
  Utensils,
].forEach(interopIcon);

const PLACE = paletteAccent(1);

// Order / Reserve are intentionally not surfaced (mirrors the web ActionRow HIDDEN_KINDS /
// PlaceNote port), so existing enriched items drop them without a data migration.
const HIDDEN_KINDS = new Set<PlaceAction["kind"]>(["order", "reserve"]);
const ACTION_ICON: Record<PlaceAction["kind"], LucideIcon> = {
  directions: MapPin,
  reserve: CalendarCheck,
  order: ShoppingBag,
  call: Phone,
  website: Globe,
  instagram: Camera, // lucide-react-native dropped brand glyphs; Camera stands in for Instagram
};

function ActionRow({ actions }: { actions?: PlaceAction[] }) {
  const shown = actions?.filter((a) => !HIDDEN_KINDS.has(a.kind)) ?? [];
  if (!shown.length) return null;
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {shown.map((a) => {
        const Icon = ACTION_ICON[a.kind] ?? Globe;
        return (
          <Pressable
            key={a.kind + a.url}
            onPress={() => Linking.openURL(a.url).catch(() => {})}
            className="flex-row items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 active:opacity-70"
          >
            <Icon size={14} className="text-place" />
            <Text className="text-xs text-ink-soft">{a.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Google's opening_hours weekday lines look like "Friday: 9:00 AM – 11:00 PM". Pull out today's
// hours for the compact disclosure summary. Port of PlaceNote.tsx todaysHours.
function todaysHours(hours: string[]): string | null {
  const day = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const line = hours.find((h) => h.startsWith(day));
  if (!line) return null;
  const rest = line.slice(day.length).replace(/^:\s*/, "").trim();
  return rest || null;
}

function ChipSection({
  icon: Icon,
  title,
  values,
  filled,
}: {
  icon: LucideIcon;
  title: string;
  values?: string[];
  filled?: boolean;
}) {
  if (!values || values.length === 0) return null;
  return (
    <View className="mt-8">
      <View className="mb-3 flex-row items-center gap-2">
        <Icon size={16} className="text-place" />
        <Text className="text-sm font-semibold text-ink-soft">{title}</Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {values.map((v, i) => (
          <Text
            key={i}
            className={`rounded-full px-2.5 py-1 text-sm ${filled ? PLACE.chip : "border border-border bg-card text-ink-soft"}`}
          >
            {v}
          </Text>
        ))}
      </View>
    </View>
  );
}

function DotList({ icon: Icon, title, values }: { icon: LucideIcon; title: string; values?: string[] }) {
  if (!values || values.length === 0) return null;
  return (
    <View className="mt-8">
      <View className="mb-3 flex-row items-center gap-2">
        <Icon size={18} className="text-place" />
        <Text className="font-serif text-xl text-ink">{title}</Text>
      </View>
      <View className="gap-3">
        {values.map((v, i) => (
          <View key={i} className="flex-row items-start gap-3">
            <View className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-place" />
            <Text className="flex-1 leading-relaxed text-ink">{v}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// The venue detail page: photo hero, address/rating/price, region-aware actions, status buttons
// (Saved/To visit/Visited + revisit), personal rating + notes when visited, favorite toggle,
// hours disclosure, must-try/good-for/highlights/tips from the source, an embedded mini-map,
// "From note" links, and delete. Live-listens to the item; rich Google data (hours/photo) is
// fetched on demand and not stored on the item.
export default function PlaceItemScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const id = String(itemId);
  const { user } = useAuth();
  const router = useRouter();
  const t = useTokens();

  const [item, setItem] = useState<PlaceItem | null | undefined>(undefined);
  const [details, setDetails] = useState<PlaceItemDetails>({});
  const [sources, setSources] = useState<{ id: string; title: string }[]>([]);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [deleting, setDeleting] = useState(false);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;
    return watchPlaceItem(user.uid, id, setItem);
  }, [user, id]);

  useEffect(() => {
    getPlaceItemDetails(id)
      .then(setDetails)
      .catch(() => setDetails({}));
  }, [id]);

  // Seed the notes field once the item first loads (don't fight live updates after).
  useEffect(() => {
    if (item) setNotesDraft((prev) => (prev === "" ? item.user_notes ?? "" : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  useEffect(() => {
    const ids = item?.source_note_ids ?? [];
    if (ids.length === 0) {
      setSources([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const notes = await Promise.all(ids.map((nid) => getNote(nid).catch((): Note | null => null)));
      if (cancelled) return;
      setSources(
        notes.flatMap((n, i) => (n ? [{ id: ids[i], title: n.title || "Source note" }] : [])),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [item?.source_note_ids]);

  const setStatus = useCallback(
    (status: PlaceItem["place_status"]) => {
      if (!item) return;
      updatePlaceItem(item.id, { place_status: status }).catch((err) =>
        Alert.alert("Couldn't update", err instanceof ApiError ? err.message : "Please try again."),
      );
    },
    [item],
  );

  const logVisit = useCallback(() => {
    if (!item) return;
    updatePlaceItem(item.id, { log_visit: true }).catch(() => {});
  }, [item]);

  const toggleFavorite = useCallback(() => {
    if (!item) return;
    updatePlaceItem(item.id, { favorite: !item.favorite }).catch((err) =>
      Alert.alert("Couldn't update", err instanceof ApiError ? err.message : "Please try again."),
    );
  }, [item]);

  const rate = useCallback(
    (n: number) => {
      if (!item) return;
      updatePlaceItem(item.id, { user_rating: n }).catch(() => {});
    },
    [item],
  );

  const onNotesChange = useCallback(
    (v: string) => {
      if (!item) return;
      setNotesDraft(v);
      if (notesTimer.current) clearTimeout(notesTimer.current);
      notesTimer.current = setTimeout(() => {
        updatePlaceItem(item.id, { user_notes: v || null }).catch(() => {});
      }, 700);
    },
    [item],
  );

  const onDelete = useCallback(() => {
    if (!item) return;
    Alert.alert("Remove from places", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deletePlaceItem(item.id);
            router.back();
          } catch (err) {
            setDeleting(false);
            Alert.alert(
              "Couldn't remove",
              err instanceof ApiError ? err.message : "Please try again.",
            );
          }
        },
      },
    ]);
  }, [item, router]);

  if (item === undefined) {
    return (
      <View className="flex-1 bg-paper">
        <SafeAreaView className="flex-1 items-center justify-center">
          <ActivityIndicator color={t.ink} />
        </SafeAreaView>
      </View>
    );
  }

  if (item === null) {
    return (
      <View className="flex-1 bg-paper">
        <SafeAreaView className="flex-1 items-center justify-center gap-3 px-8">
          <Text className="font-serif text-2xl text-ink">Not found</Text>
          <Text className="text-center text-ink-soft">This place isn&rsquo;t in your list.</Text>
          <Pressable onPress={() => router.back()} className="mt-2">
            <Text className="text-place">Go back</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  const photo = item.photo_url ?? details.photo_url ?? null;
  const hours = item.opening_hours?.length ? item.opening_hours : (details.opening_hours ?? []);
  const summary = details.editorial_summary ?? null;
  const address = item.formatted_address ?? details.formatted_address ?? item.location ?? null;
  const price = item.price_level || item.price_for_two;
  const today = hours.length ? todaysHours(hours) : null;
  const visitCount = item.visit_count ?? 0;
  const hasCoords = typeof item.lat === "number" && typeof item.lng === "number";

  return (
    <View className="flex-1 bg-paper">
      <SafeAreaView className="flex-1" edges={["top"]}>
        <View className="absolute left-2 top-2 z-10">
          <Pressable
            accessibilityLabel="Back"
            onPress={() => router.back()}
            className="h-10 w-10 items-center justify-center rounded-full bg-black/30 active:opacity-70"
          >
            <ChevronLeft size={24} color="#fff" />
          </Pressable>
        </View>
        <ScrollView contentContainerClassName="pb-16">
          {/* Photo hero */}
          <View className={`h-52 w-full overflow-hidden ${PLACE.soft}`}>
            {photo ? (
              <Image source={{ uri: photo }} style={{ flex: 1 }} contentFit="cover" />
            ) : (
              <View className="flex-1 items-center justify-center">
                <MapPin size={48} className="text-place/40" />
              </View>
            )}
          </View>

          <View className="px-5 pt-5">
            <Text className="font-serif text-2xl leading-tight text-ink">{item.name}</Text>
            <View className="mt-2 flex-row flex-wrap items-center gap-x-3 gap-y-1">
              {address ? (
                <View className="flex-row items-center gap-1.5">
                  <MapPin size={14} className="text-place" />
                  <Text className="text-sm text-ink-soft">{address}</Text>
                </View>
              ) : null}
              {item.rating ? (
                <View className="flex-row items-center gap-1">
                  <Star size={14} className="text-favorite" fill="currentColor" />
                  <Text className="text-sm text-ink-soft">
                    {item.rating}
                    {item.user_rating_count ? ` (${item.user_rating_count.toLocaleString()})` : ""}
                  </Text>
                </View>
              ) : null}
              {price ? <Text className="text-sm text-ink-soft">{price}</Text> : null}
            </View>

            <View className="mt-4">
              <ActionRow actions={item.action_links} />
            </View>

            {/* Status + favorite */}
            <View className="mt-4 flex-row flex-wrap items-center gap-2">
              {(["saved", "to_visit", "visited"] as const).map((s) => {
                const active = item.place_status === s;
                const label = s === "saved" ? "Saved" : s === "to_visit" ? "To visit" : "Been";
                return (
                  <Pressable
                    key={s}
                    onPress={() => setStatus(s)}
                    className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 active:opacity-80 ${
                      active ? "border-transparent bg-place" : "border-border bg-card"
                    }`}
                  >
                    <Text className={`text-sm font-medium ${active ? "text-place-on" : "text-ink"}`}>
                      {active && s === "visited" && visitCount > 1 ? `Been ${visitCount}×` : label}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={toggleFavorite}
                className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 active:opacity-80 ${
                  item.favorite ? "border-transparent bg-favorite" : "border-border bg-card"
                }`}
              >
                <Star
                  size={14}
                  className={item.favorite ? "text-favorite-on" : "text-ink"}
                  fill={item.favorite ? "currentColor" : "transparent"}
                />
                <Text className={`text-sm font-medium ${item.favorite ? "text-favorite-on" : "text-ink"}`}>
                  Favorite
                </Text>
              </Pressable>
              {/* A place is revisitable — log each return without overwriting history. */}
              {item.place_status === "visited" && (
                <Pressable
                  onPress={logVisit}
                  className="flex-row items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 active:opacity-70"
                >
                  <Repeat size={14} className="text-ink" />
                  <Text className="text-sm font-medium text-ink">I went again</Text>
                </Pressable>
              )}
            </View>

            {/* Personal rating — only on a visited place */}
            {item.place_status === "visited" && (
              <View className="mt-3 flex-row items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} accessibilityLabel={`Rate ${n} of 5`} onPress={() => rate(n)} className="p-0.5">
                    <Star
                      size={22}
                      className={(item.user_rating ?? 0) >= n ? "text-favorite" : "text-ink-soft/40"}
                      fill={(item.user_rating ?? 0) >= n ? "currentColor" : "transparent"}
                    />
                  </Pressable>
                ))}
              </View>
            )}

            {/* Your notes */}
            <View className="mt-6">
              <Text className="mb-2 text-sm font-semibold text-ink-soft">Your notes</Text>
              <TextInput
                value={notesDraft}
                onChangeText={onNotesChange}
                multiline
                placeholder="What to order, who you went with, what you thought…"
                placeholderTextColor={t["ink-soft"]}
                className="min-h-[80px] rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-ink"
              />
            </View>

            {summary ? (
              <Text className="mt-6 leading-relaxed text-ink">{summary}</Text>
            ) : null}

            {hasCoords && (
              <View className="mt-6 overflow-hidden rounded-2xl border border-border" style={{ height: 224 }}>
                <MapView
                  pins={[{ lat: item.lat as number, lng: item.lng as number, color: "#3c7b54" }]}
                  height={224}
                />
              </View>
            )}

            {hours.length > 0 && (
              <View className="mt-8">
                <Pressable
                  onPress={() => setHoursOpen((o) => !o)}
                  className="flex-row items-center gap-2 active:opacity-70"
                >
                  <Clock size={16} className="text-place" />
                  <Text className="flex-1 text-sm font-semibold text-ink-soft">
                    {today ? `Today · ${today}` : "Hours"}
                  </Text>
                  <ChevronDown size={16} className="text-ink-soft" />
                </Pressable>
                {hoursOpen && (
                  <View className="mt-2 gap-1 pl-6">
                    {hours.map((h, i) => (
                      <Text key={i} className="text-sm text-ink-soft">
                        {h}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            )}

            <ChipSection icon={Utensils} title="Must try" values={item.must_try} filled />
            <DotList icon={Sparkles} title="Highlights" values={item.highlights} />
            <ChipSection icon={Users} title="Good for" values={item.good_for} />

            {item.tips && item.tips.length > 0 && (
              <View className="mt-8 rounded-2xl border border-border bg-card p-5">
                <View className="mb-3 flex-row items-center gap-2">
                  <Lightbulb size={16} className="text-place" />
                  <Text className="font-serif text-xl text-ink">Tips</Text>
                </View>
                <View className="gap-2.5">
                  {item.tips.map((tip, i) => (
                    <View key={i} className="flex-row items-start gap-3">
                      <View className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-place" />
                      <Text className="flex-1 text-ink">{tip}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {sources.length > 0 && (
              <View className="mt-8">
                <Text className="mb-3 text-sm font-semibold text-ink-soft">From your notes</Text>
                <View className="gap-1.5">
                  {sources.map((s) => (
                    <Pressable
                      key={s.id}
                      onPress={() => router.push(`/note/${s.id}`)}
                      className="flex-row items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 active:opacity-70"
                    >
                      <FileText size={14} className="text-ink-soft" />
                      <Text className="flex-1 text-sm text-ink" numberOfLines={1}>
                        {s.title}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            <Pressable
              onPress={onDelete}
              disabled={deleting}
              className="mt-10 flex-row items-center gap-1.5 self-start active:opacity-70"
              style={{ opacity: deleting ? 0.6 : 1 }}
            >
              <Trash2 size={16} className="text-ink-soft" />
              <Text className="text-sm text-ink-soft">Remove from places</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
