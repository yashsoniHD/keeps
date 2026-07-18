import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { FlashList } from "@shopify/flash-list";
import Svg, { Path } from "react-native-svg";
import { GalleryHorizontalEnd, Plus, Search, Sparkles } from "lucide-react-native";
import { interopIcon } from "@/lib/note-meta";

// className styling on SVG icons requires interop registration (see note-meta).
[GalleryHorizontalEnd, Plus, Search, Sparkles].forEach(interopIcon);
import { useRouter } from "expo-router";

import type { Job, Note } from "@clipnote/shared";
import { groupNotesByCategory } from "@clipnote/shared";
import { watchNotes, watchPendingJobs } from "@/lib/firestore";
import { deleteNote } from "@/lib/api";
import { setFeedOrder } from "@/lib/note-nav";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "@/theme/ThemeProvider";
import { dark, light } from "@/theme/tokens";
import { Shelf } from "@/components/feed/Shelf";
import { FailedCard, ProcessingCard } from "@/components/feed/JobCard";

// Initial feed window — matches the web feed's page size (see frontend/src/routes/notes.index.tsx).
const FEED_PAGE_SIZE = 50;

// The single continuous paper-clip stroke of the Clipnote mark (brand kit: "the paper-clip
// identity") — identical geometry to the web ClipMark path.
// TODO: swap this local placeholder for `import { ClipMark } from "@/components/brand/ClipMark"`
// once the shared brand component lands (it is arriving concurrently).
const CLIP_PATH = "M20 31V17a6 6 0 0 1 12 0V33a8 8 0 0 1-16 0V15a10 10 0 0 1 20 0V28";
function ClipMark({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none" accessibilityRole="image">
      <Path d={CLIP_PATH} stroke={color} strokeWidth={3} strokeLinecap="round" />
    </Svg>
  );
}

// Initials from a display name ("Yash Soni" → "YS"), for the avatar fallback.
function initials(name: string | null | undefined): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

// The shelves feed flattened into one array so a single vertical FlashList renders both the
// in-flight capture rows (above) and the category shelves. getItemType lets FlashList recycle
// jobs and shelves independently.
type FeedItem =
  | { kind: "job"; id: string; job: Job; variant: "processing" | "failed" }
  | { kind: "shelf"; id: string; group: ReturnType<typeof groupNotesByCategory>[number] };

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { resolved } = useTheme();
  const t = resolved === "dark" ? dark : light;
  const [notes, setNotes] = useState<Note[]>([]);
  const [ready, setReady] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dismissedJobs, setDismissedJobs] = useState<string[]>([]);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Live feed: new/updated notes stream in without a refetch (onSnapshot).
  useEffect(() => {
    if (!user) return;
    return watchNotes(
      user.uid,
      (n) => {
        setNotes(n);
        setReady(true);
      },
      { max: FEED_PAGE_SIZE },
    );
  }, [user]);

  // In-flight + recently-failed captures (the lib already converts stale-pending → failed).
  useEffect(() => {
    if (!user) return;
    return watchPendingJobs(user.uid, setJobs);
  }, [user]);

  // Keep the pending rows' "elapsed" label fresh while any capture is in flight.
  const hasInflight = jobs.some((j) => j.status !== "failed");
  useEffect(() => {
    if (!hasInflight) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [hasInflight]);

  const visibleNotes = useMemo(
    () => notes.filter((n) => !hiddenIds.includes(n.id)),
    [notes, hiddenIds],
  );

  // The capture rows on top: failed (dismissible) first, then in-flight. Jobs whose note has
  // already landed are dropped (the shelf tile replaces them) to avoid a brief duplicate.
  const jobCards = useMemo<FeedItem[]>(() => {
    const noteUrls = new Set(notes.map((n) => n.source_url));
    const items: FeedItem[] = [];
    for (const j of jobs) {
      if (noteUrls.has(j.url)) continue;
      if (j.status === "failed") {
        if (!dismissedJobs.includes(j.id))
          items.push({ kind: "job", id: j.id, job: j, variant: "failed" });
      } else {
        items.push({ kind: "job", id: j.id, job: j, variant: "processing" });
      }
    }
    return items;
  }, [jobs, notes, dismissedJobs]);

  // Category shelves — the same grouping the web Shelves view uses (groupNotesByCategory).
  const shelfGroups = useMemo(() => groupNotesByCategory(visibleNotes), [visibleNotes]);

  const items = useMemo<FeedItem[]>(() => {
    const out: FeedItem[] = [...jobCards];
    for (const g of shelfGroups) out.push({ kind: "shelf", id: `s-${g.label}`, group: g });
    return out;
  }, [jobCards, shelfGroups]);

  // Publish the visible note order (shelf order, flattened) so the note detail's prev/next
  // follows what's on screen.
  useEffect(() => {
    setFeedOrder(shelfGroups.flatMap((g) => g.notes).map((n) => n.id));
  }, [shelfGroups]);

  const handleDelete = async (note: Note) => {
    setHiddenIds((prev) => [...prev, note.id]); // optimistic removal
    try {
      await deleteNote(note.id);
    } catch {
      setHiddenIds((prev) => prev.filter((id) => id !== note.id)); // roll back on failure
    }
  };

  const dismissJob = (jobId: string) => setDismissedJobs((prev) => [...prev, jobId]);

  // The feed is a live onSnapshot, so there is nothing to refetch — pull-to-refresh is a short
  // cosmetic spinner that acknowledges the gesture.
  const onRefresh = () => {
    setRefreshing(true);
    setNow(Date.now());
    setTimeout(() => setRefreshing(false), 600);
  };

  if (!user) return null; // the _layout auth gate redirects; this is just a null-safety guard.

  const avatarChars = initials(user.displayName);

  return (
    <View className="flex-1 bg-paper">
      <SafeAreaView edges={["top"]} className="bg-paper">
        <View className="flex-row items-center justify-between px-5 pb-3 pt-2">
          {/* The Clipnote paper-clip mark + serif wordmark. */}
          <View className="flex-row items-center gap-2.5">
            <View className="h-8 w-8 items-center justify-center rounded-xl bg-ink">
              <ClipMark size={20} color={t.paper} />
            </View>
            <Text className="font-serif text-2xl tracking-tight text-ink">Clipnote</Text>
          </View>

          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => router.push("/search")}
              accessibilityRole="button"
              accessibilityLabel="Search"
              className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:opacity-70"
            >
              <Search size={18} className="text-ink-soft" />
            </Pressable>
            {/* Layout toggle: shelves is the only mobile layout for now, so this mirrors the
                web header's toggle icon as a no-op placeholder (see Assumptions). */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change layout"
              className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:opacity-70"
            >
              <GalleryHorizontalEnd size={18} className="text-ink-soft" />
            </Pressable>
            <Pressable
              onPress={() => router.push("/settings")}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              className="h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-border bg-card active:opacity-70"
            >
              {user.photoURL ? (
                <Image
                  source={{ uri: user.photoURL }}
                  contentFit="cover"
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
                <Text className="text-xs font-medium text-ink-soft">{avatarChars || "?"}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      {!ready ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        // A single vertical FlashList is the ONE scroll container: wrapped in a flex-1 View so
        // it inherits a bounded height (the old screen let the list collapse in an unbounded
        // parent, which was the scroll bug), and alwaysBounceVertical so it still bounces with
        // little content. Each shelf holds its own horizontal FlashList of tiles.
        <View className="flex-1">
          <FlashList
            data={items}
            keyExtractor={(item) => item.id}
            getItemType={(item) => item.kind}
            renderItem={({ item }) => {
              if (item.kind === "job") {
                return (
                  <View className="mb-2 px-5">
                    {item.variant === "failed" ? (
                      <FailedCard job={item.job} onDismiss={dismissJob} />
                    ) : (
                      <ProcessingCard job={item.job} now={now} />
                    )}
                  </View>
                );
              }
              return <Shelf group={item.group} onDeleteNote={handleDelete} />;
            }}
            contentContainerStyle={{ paddingTop: 8, paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
            alwaysBounceVertical
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={<EmptyState />}
          />
        </View>
      )}

      {/* Capture FAB → the capture screen (owned by another agent; navigate by path only). */}
      <Pressable
        onPress={() => router.push("/capture")}
        accessibilityRole="button"
        accessibilityLabel="Save a link"
        className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-ink active:opacity-90"
        style={{
          shadowColor: "#000",
          shadowOpacity: 0.2,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <Plus size={26} className="text-paper" />
      </Pressable>
    </View>
  );
}

// First-run empty feed: a calm card that points at the + FAB. Copy is concise and em-dash-free
// per the project copy rules.
function EmptyState() {
  return (
    <View className="mx-5 mt-8 items-center rounded-3xl border border-dashed border-border bg-card p-8">
      <View className="h-12 w-12 items-center justify-center rounded-2xl bg-summary-soft">
        <Sparkles size={22} className="text-summary" />
      </View>
      <Text className="mt-4 text-xl font-semibold text-ink">Save your first link</Text>
      <Text className="mt-2 text-center text-sm leading-relaxed text-ink-soft">
        Tap the + button to clip any link. It becomes a clean, structured note you will actually
        come back to.
      </Text>
    </View>
  );
}
