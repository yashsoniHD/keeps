import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  CheckCircle2,
  ChevronLeft,
  Clapperboard,
  Eye,
  FileText,
  Plus,
  Star,
  Trash2,
  Tv,
} from "lucide-react-native";
import type { CastMember, Note, WatchItem, WatchItemDetails, WatchProvider } from "@clipnote/shared";
import { interopIcon, paletteAccent } from "@/lib/note-meta";
import { getNote, watchWatchItem } from "@/lib/firestore";
import { deleteWatchItem, getWatchItemDetails, updateWatchItem, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { useTokens } from "@/components/note/colors";

[ChevronLeft, Clapperboard, CheckCircle2, Eye, FileText, Plus, Star, Trash2, Tv].forEach(
  interopIcon,
);

const MEDIA = paletteAccent(4);

function runtimeLabel(d: WatchItemDetails, item: WatchItem): string | null {
  if (item.media_type === "tv") {
    if (d.number_of_seasons) return `${d.number_of_seasons} season${d.number_of_seasons === 1 ? "" : "s"}`;
    if (d.episode_run_time) return `${d.episode_run_time} min/ep`;
    return null;
  }
  if (d.runtime) {
    const h = Math.floor(d.runtime / 60);
    const m = d.runtime % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
  }
  return null;
}

// "Where to watch" — providers grouped by type (Stream / Rent / Buy). The "Streaming data by
// JustWatch" line is MANDATORY wherever providers render (project rule).
const PROVIDER_ORDER: WatchProvider["type"][] = ["flatrate", "rent", "buy"];
const PROVIDER_GROUP_LABEL: Record<WatchProvider["type"], string> = {
  flatrate: "Stream",
  rent: "Rent",
  buy: "Buy",
};

function ProvidersSection({ item }: { item: WatchItem }) {
  const providers = item.providers ?? [];
  if (providers.length === 0) return null;
  const groups = PROVIDER_ORDER.map((type) => ({
    type,
    items: providers.filter((p) => p.type === type),
  })).filter((g) => g.items.length > 0);
  if (groups.length === 0) return null;

  return (
    <View className="mt-8 gap-3">
      <Text className="text-sm font-semibold text-ink-soft">
        {item.providers_region ? `Where to watch · ${item.providers_region}` : "Where to watch"}
      </Text>
      {groups.map((g) => (
        <View key={g.type} className="gap-2">
          <Text className="text-xs text-ink-soft">{PROVIDER_GROUP_LABEL[g.type]}</Text>
          <View className="flex-row flex-wrap gap-2">
            {g.items.map((p, i) => (
              <View
                key={`${p.name}-${i}`}
                className="flex-row items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1.5"
              >
                {p.logo_url ? (
                  <Image
                    source={{ uri: p.logo_url }}
                    style={{ width: 18, height: 18, borderRadius: 4 }}
                    contentFit="cover"
                  />
                ) : null}
                <Text className="text-xs text-ink">{p.name}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
      {/* Mandatory attribution — rendered whenever any provider row exists. */}
      <Text className="text-[11px] text-ink-soft">Streaming data by JustWatch</Text>
    </View>
  );
}

function CastStrip({ cast }: { cast?: CastMember[] }) {
  if (!cast || cast.length === 0) return null;
  return (
    <View className="mt-8">
      <Text className="mb-3 text-sm font-semibold text-ink-soft">Cast</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3">
        {cast.map((c) => (
          <View key={c.name} className="w-20 items-center">
            <View className={`h-24 w-20 overflow-hidden rounded-lg ${MEDIA.soft}`}>
              {c.profile_url ? (
                <Image source={{ uri: c.profile_url }} style={{ flex: 1 }} contentFit="cover" />
              ) : null}
            </View>
            <Text className="mt-1 text-center text-xs font-medium text-ink" numberOfLines={1}>
              {c.name}
            </Text>
            {c.character ? (
              <Text className="text-center text-[10px] text-ink-soft" numberOfLines={1}>
                {c.character}
              </Text>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// The movie/show detail page: backdrop hero, overview, cast, where-to-watch, status buttons,
// rating, favorite, "From note" links, and delete. Live-listens to the item so status/rating
// changes reflect instantly; rich TMDB data (cast/runtime/vote) is fetched on demand.
export default function WatchItemScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const id = String(itemId);
  const { user } = useAuth();
  const router = useRouter();
  const t = useTokens();

  const [item, setItem] = useState<WatchItem | null | undefined>(undefined);
  const [details, setDetails] = useState<WatchItemDetails>({});
  const [sources, setSources] = useState<{ id: string; title: string }[]>([]);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    return watchWatchItem(user.uid, id, setItem);
  }, [user, id]);

  useEffect(() => {
    getWatchItemDetails(id)
      .then(setDetails)
      .catch(() => setDetails({}));
  }, [id]);

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
    (status: WatchItem["watch_status"]) => {
      if (!item) return;
      updateWatchItem(item.id, { watch_status: status }).catch((err) =>
        Alert.alert("Couldn't update", err instanceof ApiError ? err.message : "Please try again."),
      );
    },
    [item],
  );

  const toggleFavorite = useCallback(() => {
    if (!item) return;
    updateWatchItem(item.id, { favorite: !item.favorite }).catch((err) =>
      Alert.alert("Couldn't update", err instanceof ApiError ? err.message : "Please try again."),
    );
  }, [item]);

  const rate = useCallback(
    (n: number) => {
      if (!item) return;
      updateWatchItem(item.id, { rating: n }).catch(() => {});
    },
    [item],
  );

  const onDelete = useCallback(() => {
    if (!item) return;
    Alert.alert("Remove from watchlist", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteWatchItem(item.id);
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
          <Text className="text-center text-ink-soft">
            This title isn&rsquo;t in your watchlist.
          </Text>
          <Pressable onPress={() => router.back()} className="mt-2">
            <Text className="text-media">Go back</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  const Icon = item.media_type === "tv" ? Tv : Clapperboard;
  const watched = item.watch_status === "watched";
  const saved = item.watch_status === "saved";
  const favorite = !!item.favorite;
  const backdrop = item.backdrop_url ?? details.backdrop_url ?? null;
  const overview = item.overview ?? details.overview ?? null;
  const genres = item.genres?.length ? item.genres : (details.genres ?? []);
  const runtime = runtimeLabel(details, item);

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
          {/* Backdrop hero */}
          <View className={`h-56 w-full overflow-hidden ${MEDIA.soft}`}>
            {backdrop ? (
              <Image source={{ uri: backdrop }} style={{ flex: 1 }} contentFit="cover" />
            ) : (
              <View className="flex-1 items-center justify-center">
                <Icon size={48} className="text-media/40" />
              </View>
            )}
            <View className="absolute inset-x-0 bottom-0 h-20 bg-black/30" />
          </View>

          <View className="px-5 pt-5">
            <View className="flex-row gap-4">
              <View className={`w-28 shrink-0 overflow-hidden rounded-xl ${MEDIA.soft}`} style={{ aspectRatio: 2 / 3, marginTop: -56 }}>
                {item.poster_url ? (
                  <Image source={{ uri: item.poster_url }} style={{ flex: 1 }} contentFit="cover" />
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <Icon size={28} className="text-media/50" />
                  </View>
                )}
              </View>
              <View className="min-w-0 flex-1 gap-1 pt-1">
                <Text className="font-serif text-2xl leading-tight text-ink">{item.title}</Text>
                {details.tagline ? (
                  <Text className="text-sm italic text-ink-soft">{details.tagline}</Text>
                ) : null}
                <Text className="text-sm text-ink-soft">
                  {[
                    item.media_type === "tv" ? "TV series" : "Film",
                    item.year,
                    runtime,
                    details.vote_average ? `★ ${details.vote_average.toFixed(1)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
            </View>

            {genres.length > 0 && (
              <View className="mt-4 flex-row flex-wrap gap-1.5">
                {genres.map((g) => (
                  <Text key={g} className={`rounded-full px-2 py-0.5 text-xs ${MEDIA.chip}`}>
                    {g}
                  </Text>
                ))}
              </View>
            )}

            {/* Status + favorite + rating */}
            <View className="mt-5 flex-row flex-wrap items-center gap-2">
              {saved && (
                <Pressable
                  onPress={() => setStatus("to_watch")}
                  className="flex-row items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 active:opacity-70"
                >
                  <Plus size={14} className="text-ink" />
                  <Text className="text-sm font-medium text-ink">Add to watchlist</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => setStatus(watched ? "to_watch" : "watched")}
                className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 active:opacity-80 ${
                  watched ? "border-transparent bg-media" : "border-border bg-card"
                }`}
              >
                {watched ? (
                  <CheckCircle2 size={14} className="text-media-on" />
                ) : (
                  <Eye size={14} className="text-ink" />
                )}
                <Text className={`text-sm font-medium ${watched ? "text-media-on" : "text-ink"}`}>
                  {watched ? "Watched" : "Mark watched"}
                </Text>
              </Pressable>
              <Pressable
                onPress={toggleFavorite}
                className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 active:opacity-80 ${
                  favorite ? "border-transparent bg-favorite" : "border-border bg-card"
                }`}
              >
                <Star
                  size={14}
                  className={favorite ? "text-favorite-on" : "text-ink"}
                  fill={favorite ? "currentColor" : "transparent"}
                />
                <Text className={`text-sm font-medium ${favorite ? "text-favorite-on" : "text-ink"}`}>
                  Favorite
                </Text>
              </Pressable>
            </View>

            {watched && (
              <View className="mt-3 flex-row items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} accessibilityLabel={`Rate ${n} of 5`} onPress={() => rate(n)} className="p-0.5">
                    <Star
                      size={22}
                      className={(item.rating ?? 0) >= n ? "text-favorite" : "text-ink-soft/40"}
                      fill={(item.rating ?? 0) >= n ? "currentColor" : "transparent"}
                    />
                  </Pressable>
                ))}
              </View>
            )}

            {overview && (
              <View className="mt-8">
                <Text className="mb-2 text-sm font-semibold text-ink-soft">Overview</Text>
                <Text className="leading-relaxed text-ink">{overview}</Text>
              </View>
            )}

            <CastStrip cast={details.cast} />
            <ProvidersSection item={item} />

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
              <Text className="text-sm text-ink-soft">Remove from watchlist</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
