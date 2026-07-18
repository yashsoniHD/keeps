import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import type { MyDigestResponse } from "@clipnote/shared";
import { useTheme } from "@/theme/ThemeProvider";
import { noteAccent, paletteAccent } from "@/lib/note-meta";
import { fmtDay, slideColors } from "./colors";
import {
  CategoriesSlide,
  FinaleSlide,
  HeroSlide,
  IntroSlide,
  NoStorySlide,
  SectionSlide,
  SourcesSlide,
} from "./slides";

type SlideDef = { bg: string; on: string; render: (active: boolean) => ReactNode };

export function WrappedStories({
  data,
  onClose,
  onOpenNote,
  onRegenerate,
  regenerating,
}: {
  data: MyDigestResponse;
  onClose: () => void;
  onOpenNote: (id: string) => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<SlideDef>>(null);
  const [active, setActive] = useState(0);

  // Mirror the web's palette rotation exactly: a running counter feeds paletteAccent so
  // consecutive slides land on different palettes; category-driven slides override with their
  // own accent. Start on plum (index 4) for a bold opener.
  const slides = useMemo<SlideDef[]>(() => {
    const { stats, digest, note_refs, stale } = data;
    const out: SlideDef[] = [];
    let a = 4;
    const push = (accentIndexOverride: number | null, render: (on: string) => (active: boolean) => ReactNode) => {
      const accent = accentIndexOverride == null ? paletteAccent(a++) : paletteAccent(accentIndexOverride);
      const { bg, on } = slideColors(accent, isDark);
      out.push({ bg, on, render: render(on) });
    };
    // A category-slide reuses noteAccent(slug); resolve it to colours directly here.
    const pushCategory = (slug: string, render: (on: string) => (active: boolean) => ReactNode) => {
      const { bg, on } = slideColors(noteAccent(slug), isDark);
      out.push({ bg, on, render: render(on) });
    };

    if (stats) {
      push(null, (on) => (act) => <HeroSlide on={on} active={act} stats={stats} />);
      if (stats.categories.length > 0) {
        pushCategory(stats.categories[0].slug, (on) => (act) => (
          <CategoriesSlide on={on} active={act} categories={stats.categories} />
        ));
      }
      if (stats.top_domains.length > 0 || stats.busiest_day || stats.active_days > 0) {
        push(null, (on) => (act) => <SourcesSlide on={on} active={act} stats={stats} />);
      }
    }

    if (digest) {
      push(null, (on) => (act) => (
        <IntroSlide on={on} active={act} intro={digest.intro} facts={digest.facts} />
      ));
      for (const sec of digest.sections.slice(0, 4)) {
        push(null, (on) => (act) => (
          <SectionSlide
            on={on}
            active={act}
            heading={sec.heading}
            body={sec.body}
            items={sec.items ?? []}
            onOpenNote={onOpenNote}
          />
        ));
      }
    } else if (stale && stats) {
      push(null, (on) => (act) => <NoStorySlide on={on} active={act} />);
    }

    push(null, (on) => (act) => (
      <FinaleSlide
        on={on}
        active={act}
        fallback={stats?.fallback ?? false}
        noteRefs={note_refs}
        onOpenNote={onOpenNote}
        onRegenerate={onRegenerate}
        regenerating={regenerating}
      />
    ));
    return out;
  }, [data, isDark, onOpenNote, onRegenerate, regenerating]);

  const count = slides.length;
  const activeOn = slides[Math.min(active, count - 1)]?.on ?? "#ffffff";

  const goTo = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(count - 1, i));
      listRef.current?.scrollToOffset({ offset: clamped * width, animated: true });
      setActive(clamped);
    },
    [count, width],
  );

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (width === 0) return;
      setActive(Math.round(e.nativeEvent.contentOffset.x / width));
    },
    [width],
  );

  // Story-style tap zones: the left third goes back, the rest advances — read off the tap's
  // absolute X. Deep-link chips are nested Pressables, so tapping one fires its own handler and
  // this outer press never runs (RN gives the touch to the innermost pressable); a swipe/scroll
  // (movement) cancels the press, so it never fights the FlatList.
  const onTap = useCallback(
    (pageX: number) => {
      goTo(pageX < width * 0.3 ? active - 1 : active + 1);
    },
    [active, width, goTo],
  );

  return (
    <View style={{ flex: 1, backgroundColor: slides[0]?.bg ?? "#000" }}>
      <FlatList
        ref={listRef}
        data={slides}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        extraData={active}
        onMomentumScrollEnd={onMomentumEnd}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        renderItem={({ item, index }) => {
          const isActive = index === active;
          return (
            <View style={{ width, backgroundColor: item.bg }}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  flexGrow: 1,
                  justifyContent: "center",
                  paddingHorizontal: 28,
                  paddingTop: insets.top + 72,
                  paddingBottom: insets.bottom + 40,
                }}
              >
                <Pressable onPress={(e) => onTap(e.nativeEvent.pageX)}>
                  {/* Remount on activation so the staggered entry replays on each entry, like
                      the web's keyed SlideShell. */}
                  <View key={isActive ? "on" : "off"}>{item.render(isActive)}</View>
                </Pressable>
              </ScrollView>
            </View>
          );
        }}
      />

      {/* Progress + close overlay, tinted to the active slide's `on` colour so both read on any
          accent. box-none lets taps/swipes fall through to the slides; only the close button
          catches touches. */}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          paddingHorizontal: 12,
          paddingTop: insets.top + 12,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", gap: 4 }}>
          {slides.map((_, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 999,
                backgroundColor: activeOn,
                opacity: i <= active ? 0.9 : 0.3,
              }}
            />
          ))}
        </View>
        <View
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        >
          {data.stale && data.digest?.generated_at ? (
            <View
              style={{
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 4,
                backgroundColor: "rgba(0,0,0,0.1)",
              }}
            >
              <Text style={{ color: activeOn, fontSize: 11, fontWeight: "500" }}>
                From {fmtDay(data.digest.generated_at.slice(0, 10))}
              </Text>
            </View>
          ) : (
            <View />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={({ pressed }) => ({
              height: 36,
              width: 36,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
              backgroundColor: pressed ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.1)",
            })}
          >
            <X size={18} color={activeOn} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
