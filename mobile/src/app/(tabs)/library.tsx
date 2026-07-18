import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Clapperboard, FolderPlus, MapPin, Plus } from "lucide-react-native";
import type { Collection, Note } from "@clipnote/shared";
import {
  watchFavorites,
  watchCollections,
  getMiniAppItemCounts,
  getCollectionNoteCount,
  type MiniAppItemCounts,
} from "@/lib/firestore";
import { deleteNote } from "@/lib/api";
import {
  defaultPaletteFor,
  iconByName,
  interopIcon,
  paletteAccent,
} from "@/lib/note-meta";
import { useAuth } from "@/contexts/auth-context";
import { NoteCard } from "@/components/feed/NoteCard";
import { NewCollectionSheet } from "@/components/library/NewCollectionSheet";

// className styling on SVG icons requires interop registration (see note-meta).
[Clapperboard, FolderPlus, MapPin, Plus].forEach(interopIcon);

// The two mini-app tools (Watchlist, Places), ported from the web's collections-meta TOOLS
// list minus the Notes catch-all (Notes is the home feed, not a Library tile). Palette indices
// line up with note-meta's PALETTES order (1 = place, 4 = media) so these tiles wear the same
// domain colour as the note cards that feed them.
const APP_TILES = [
  {
    key: "watchlist" as const,
    label: "Watchlist",
    desc: "Movies & shows",
    path: "/watchlist",
    icon: Clapperboard,
    paletteIndex: 4,
  },
  {
    key: "places" as const,
    label: "Places",
    desc: "Food & drink",
    path: "/places",
    icon: MapPin,
    paletteIndex: 1,
  },
];

// Quiet count in a tile's top-right corner: a skeleton while loading, a dash on a terminal
// error, or the number itself. Mirrors the web CollectionsPage's CountCorner.
function CountCorner({ count }: { count: number | "loading" | "error" }) {
  if (count === "loading") return <View className="mt-0.5 h-3.5 w-6 rounded bg-ink/10" />;
  if (count === "error") return <Text className="mt-0.5 text-xs text-ink-soft">–</Text>;
  return <Text className="mt-0.5 text-xs text-ink-soft">{count}</Text>;
}

const TILE_BASE = "min-h-[112px] justify-between gap-5 rounded-2xl border p-4 active:opacity-90";

export default function LibraryScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [favorites, setFavorites] = useState<Note[]>([]);
  const [appCounts, setAppCounts] = useState<MiniAppItemCounts | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({});
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    if (!user) return;
    return watchFavorites(user.uid, setFavorites, { onError: () => {} });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return watchCollections(user.uid, setCollections, { onError: () => {} });
  }, [user]);

  // One aggregate shot per subcollection on mount — quiet counts, no listener. Resilient:
  // getMiniAppItemCounts already returns a per-app null on partial failure; this catch only
  // covers a total failure and lands on an all-dashes terminal state, never a stuck skeleton.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getMiniAppItemCounts(user.uid)
      .then((c) => {
        if (!cancelled) setAppCounts(c);
      })
      .catch(() => {
        if (!cancelled) setAppCounts({ watchlist: null, places: null });
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Note counts per collection: cheap best-effort aggregate reads, filled in as they resolve.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    collections.forEach((c) => {
      if (noteCounts[c.id] !== undefined) return;
      getCollectionNoteCount(user.uid, c.id)
        .then((n) => {
          if (!cancelled) setNoteCounts((prev) => ({ ...prev, [c.id]: n }));
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
    // noteCounts intentionally omitted: it only grows, and including it would refire per fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, collections]);

  const handleDelete = async (note: Note) => {
    setFavorites((prev) => prev.filter((n) => n.id !== note.id));
    try {
      await deleteNote(note.id);
    } catch {
      // The favorites listener resyncs on the next snapshot regardless.
    }
  };

  if (!user) return null;

  return (
    <View className="flex-1 bg-paper">
      <SafeAreaView edges={["top"]}>
        <View className="px-5 pb-3 pt-2">
          <Text className="text-2xl font-semibold text-ink">Library</Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerClassName="gap-6 px-5 pb-16">
        {/* Favorites — a live query, not a stored list, so a star/unstar reflects instantly. */}
        {favorites.length > 0 && (
          <View>
            <Text className="mb-2 px-1 text-xs uppercase tracking-wider text-ink-soft">
              Favorites
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-3 pr-2"
            >
              {favorites.map((note) => (
                <View key={note.id} style={{ width: 240 }}>
                  <NoteCard note={note} onDelete={handleDelete} />
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Watchlist + Places — the two mini-apps, color-coded with live item counts. Their
            routes are being built by a concurrent agent — navigate by path only. */}
        <View className="flex-row gap-3">
          {APP_TILES.map((tile) => {
            const accent = paletteAccent(tile.paletteIndex);
            const Icon = tile.icon;
            const count = appCounts === null ? "loading" : appCounts[tile.key] ?? "error";
            return (
              <Pressable
                key={tile.key}
                onPress={() => router.push(tile.path as never)}
                className={`flex-1 ${TILE_BASE} ${accent.wash}`}
              >
                <View className="flex-row items-start justify-between">
                  <View
                    className={`h-10 w-10 items-center justify-center rounded-full ${accent.dot} ${accent.on}`}
                  >
                    <Icon size={18} />
                  </View>
                  <CountCorner count={count} />
                </View>
                <View>
                  <Text className={`font-semibold ${accent.text}`} numberOfLines={1}>
                    {tile.label}
                  </Text>
                  <Text className="text-sm text-ink-soft" numberOfLines={1}>
                    {tile.desc}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* The user's own smart collections. */}
        <View>
          <Text className="mb-2 px-1 text-xs uppercase tracking-wider text-ink-soft">
            Your collections
          </Text>
          <View className="flex-row flex-wrap gap-3">
            {collections.map((c) => {
              const accent = paletteAccent(c.palette ?? defaultPaletteFor(c.name));
              const Icon = iconByName(c.icon) ?? FolderPlus;
              const count = noteCounts[c.id];
              return (
                <Pressable
                  key={c.id}
                  onPress={() => router.push(`/collection/${c.id}` as never)}
                  style={{ width: "47%" }}
                  className={`${TILE_BASE} ${accent.wash}`}
                >
                  <View className="flex-row items-start justify-between">
                    <View
                      className={`h-10 w-10 items-center justify-center rounded-full ${accent.dot} ${accent.on}`}
                    >
                      <Icon size={18} />
                    </View>
                    {count !== undefined && <CountCorner count={count} />}
                  </View>
                  <Text className={`font-semibold ${accent.text}`} numberOfLines={1}>
                    {c.name}
                  </Text>
                </Pressable>
              );
            })}

            {/* New collection: opens the same smart-collection sheet the web Library uses. */}
            <Pressable
              onPress={() => setShowNew(true)}
              style={{ width: "47%" }}
              className={`${TILE_BASE} border-dashed border-border bg-card/50`}
            >
              <View className="h-10 w-10 items-center justify-center rounded-full border border-dashed border-border bg-card">
                <Plus size={18} className="text-ink-soft" />
              </View>
              <View>
                <Text className="font-semibold text-ink" numberOfLines={1}>
                  New collection
                </Text>
                <Text className="text-sm text-ink-soft" numberOfLines={1}>
                  Trips, gifts, anything
                </Text>
              </View>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <NewCollectionSheet uid={user.uid} visible={showNew} onClose={() => setShowNew(false)} />
    </View>
  );
}
