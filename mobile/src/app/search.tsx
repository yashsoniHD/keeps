import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { Stack, useRouter } from "expo-router";
import { ArrowLeft, Search as SearchIcon, Sparkles, X } from "lucide-react-native";
import { searchNotes, type SearchResult } from "@/lib/api";
import { interopIcon, noteAccent, noteIcon } from "@/lib/note-meta";
import { useTheme } from "@/theme/ThemeProvider";
import { dark, light } from "@/theme/tokens";

// className styling on SVG icons requires interop registration (see note-meta).
[ArrowLeft, SearchIcon, Sparkles, X].forEach(interopIcon);

// Global semantic search across everything saved (GET /api/search over the search_index).
// Port of frontend/src/routes/search.tsx: debounce + minimum length match the web screen so
// the two clients feel identical.
const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

type Status = "idle" | "searching" | "done" | "error";

function ResultRow({ hit, onOpen }: { hit: SearchResult; onOpen: () => void }) {
  const accent = noteAccent(hit.content_type);
  const Icon = noteIcon(hit.content_type);
  return (
    <Pressable
      onPress={onOpen}
      className="mb-2 flex-row items-center gap-3 rounded-2xl border border-border bg-card p-3 active:opacity-80"
    >
      <View className={`h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl ${accent.soft}`}>
        {hit.cover_image_url ? (
          <Image
            source={{ uri: hit.cover_image_url }}
            contentFit="cover"
            style={{ width: 48, height: 48 }}
          />
        ) : (
          <Icon size={20} className={accent.text} />
        )}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-medium text-ink" numberOfLines={1}>
          {hit.title || "Untitled"}
        </Text>
        {hit.ai_summary ? (
          <Text className="mt-0.5 text-sm text-ink-soft" numberOfLines={1}>
            {hit.ai_summary}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const { resolved } = useTheme();
  const tokens = resolved === "dark" ? dark : light;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const inputRef = useRef<TextInput>(null);

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < MIN_CHARS) {
      setResults([]);
      setStatus("idle");
      return;
    }
    setStatus("searching");
    const handle = setTimeout(async () => {
      try {
        const res = await searchNotes(trimmed);
        setResults(res);
        setStatus("done");
      } catch {
        setResults([]);
        setStatus("error");
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [trimmed]);

  const open = (hit: SearchResult) => router.push(`/note/${hit.ref_id ?? hit.id}`);
  const askAbout = () => router.push(`/ask?q=${encodeURIComponent(trimmed)}`);

  return (
    <View className="flex-1 bg-paper">
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
        <View className="flex-row items-center gap-3 px-5 pt-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            className="h-10 w-10 items-center justify-center rounded-full"
          >
            <ArrowLeft size={20} className="text-ink-soft" />
          </Pressable>
          <View className="relative flex-1">
            <SearchIcon size={16} className="absolute left-4 top-3.5 text-ink-soft" />
            <TextInput
              ref={inputRef}
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search everything you've saved"
              placeholderTextColor={tokens["ink-soft"]}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              className="h-11 rounded-full border border-border bg-card pl-11 pr-10 text-base text-ink"
            />
            {query.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear"
                onPress={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="absolute right-3 top-2 p-1.5"
              >
                <X size={16} className="text-ink-soft" />
              </Pressable>
            )}
          </View>
        </View>

        <View className="flex-1 px-5 pt-4">
          {trimmed.length >= MIN_CHARS && (
            <Pressable
              onPress={askAbout}
              accessibilityRole="button"
              accessibilityLabel={`Ask Clipnote AI about ${trimmed}`}
              className="mb-4 flex-row items-center justify-center gap-2 rounded-full bg-product-soft px-4 py-3 active:opacity-80"
            >
              <Sparkles size={16} className="text-product" />
              <Text className="text-sm font-medium text-product" numberOfLines={1}>
                Ask Clipnote AI about &ldquo;{trimmed}&rdquo;
              </Text>
            </Pressable>
          )}

          {trimmed.length < MIN_CHARS ? (
            <View className="flex-1 items-center justify-center gap-3 pb-24">
              <SearchIcon size={32} className="text-ink-soft" strokeWidth={1.5} />
              <Text className="max-w-[260px] text-center text-sm text-ink-soft">
                Search everything you have saved: by topic, title, or place name.
              </Text>
            </View>
          ) : status === "searching" ? (
            <View className="flex-1 flex-row items-center justify-center gap-2 pb-24">
              <ActivityIndicator />
              <Text className="text-sm text-ink-soft">Searching…</Text>
            </View>
          ) : status === "error" ? (
            <View className="rounded-2xl bg-destructive/10 p-4">
              <Text className="text-center text-sm text-destructive">
                Search didn't work just now. Try again.
              </Text>
            </View>
          ) : results.length === 0 ? (
            <View className="flex-1 items-center justify-center gap-2 pb-24">
              <Text className="text-sm text-ink-soft">
                Nothing matched &ldquo;{trimmed}&rdquo;.
              </Text>
              <Text className="text-xs text-ink-soft">Try a different word, a title, or a place name.</Text>
            </View>
          ) : (
            <FlashList
              data={results}
              keyExtractor={(hit) => hit.ref_id ?? hit.id}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => <ResultRow hit={item} onOpen={() => open(item)} />}
              contentContainerStyle={{ paddingBottom: 40 }}
            />
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
