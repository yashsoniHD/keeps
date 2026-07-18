import { Pressable, Text, View } from "react-native";
import { ArrowRight, CalendarClock, RotateCw } from "lucide-react-native";
import type { NoteRef, PersonalDigestStats } from "@clipnote/shared";
import { noteIcon, noteLabel } from "@/lib/note-meta";
import { chipFill, fmtDay } from "./colors";
import { Kicker, Reveal } from "./primitives";

// Every slide paints its own text with the accent's WCAG-safe `on` hex (passed down from the
// shell) and uses a flat black inset for chips/cards — mirroring the web SlideShell.

// ─── Hero: the headline count ────────────────────────────────────────────────
export function HeroSlide({
  on,
  active,
  stats,
}: {
  on: string;
  active: boolean;
  stats: PersonalDigestStats;
}) {
  return (
    <View style={{ gap: 20 }}>
      <Kicker on={on} active={active}>
        {stats.fallback ? "Your latest saves" : "Your week"}
      </Kicker>
      <Reveal active={active} i={1} style={{ gap: 2 }}>
        <Text className="font-serif" style={{ color: on, fontSize: 34, lineHeight: 38 }}>
          You saved
        </Text>
        <Text
          className="font-serif"
          style={{ color: on, fontSize: 96, lineHeight: 100, fontVariant: ["tabular-nums"] }}
        >
          {stats.total}
        </Text>
        <Text className="font-serif" style={{ color: on, fontSize: 34, lineHeight: 38 }}>
          {stats.fallback ? "of your latest saves" : "things this week"}
        </Text>
      </Reveal>
      {stats.window_start && stats.window_end && !stats.fallback ? (
        <Reveal active={active} i={2}>
          <Text style={{ color: on, opacity: 0.7, fontSize: 14 }}>
            {fmtDay(stats.window_start)} to {fmtDay(stats.window_end)}
          </Text>
        </Reveal>
      ) : null}
    </View>
  );
}

// ─── Categories: #1 callout + the runners-up ─────────────────────────────────
export function CategoriesSlide({
  on,
  active,
  categories,
}: {
  on: string;
  active: boolean;
  categories: PersonalDigestStats["categories"];
}) {
  const top = categories.slice(0, 5);
  const [first, ...rest] = top;
  if (!first) return null;
  const FirstIcon = noteIcon(first.slug);
  return (
    <View style={{ gap: 20 }}>
      <Kicker on={on} active={active}>
        What you saved
      </Kicker>
      <Reveal active={active} i={1}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View
            style={{
              height: 48,
              width: 48,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: chipFill(),
            }}
          >
            <FirstIcon size={24} color={on} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text className="font-serif" numberOfLines={1} style={{ color: on, fontSize: 28 }}>
              {noteLabel(first.slug)}
            </Text>
            <Text style={{ color: on, opacity: 0.7, fontSize: 14 }}>
              {first.count} {first.count === 1 ? "note" : "notes"} · your top pick
            </Text>
          </View>
        </View>
      </Reveal>
      {rest.length > 0 ? (
        <Reveal active={active} i={2} style={{ gap: 10 }}>
          {rest.map((c) => {
            const Icon = noteIcon(c.slug);
            return (
              <View
                key={c.slug}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  borderRadius: 16,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  backgroundColor: chipFill(),
                }}
              >
                <Icon size={16} color={on} style={{ opacity: 0.8 }} />
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, color: on, fontSize: 14, fontWeight: "500" }}
                >
                  {noteLabel(c.slug)}
                </Text>
                <Text style={{ color: on, opacity: 0.7, fontSize: 14 }}>{c.count}</Text>
              </View>
            );
          })}
        </Reveal>
      ) : null}
    </View>
  );
}

// ─── Sources: where the saves came from + rhythm stats ───────────────────────
export function SourcesSlide({
  on,
  active,
  stats,
}: {
  on: string;
  active: boolean;
  stats: PersonalDigestStats;
}) {
  const domains = stats.top_domains.slice(0, 4);
  return (
    <View style={{ gap: 20 }}>
      <Kicker on={on} active={active}>
        Where it came from
      </Kicker>
      {domains.length > 0 ? (
        <Reveal active={active} i={1} style={{ gap: 10 }}>
          {domains.map((d) => (
            <View
              key={d.domain}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                borderRadius: 16,
                paddingHorizontal: 14,
                paddingVertical: 10,
                backgroundColor: chipFill(),
              }}
            >
              <Text
                numberOfLines={1}
                style={{ flex: 1, color: on, fontSize: 14, fontWeight: "500" }}
              >
                {d.domain}
              </Text>
              <Text style={{ color: on, opacity: 0.7, fontSize: 14 }}>{d.count}</Text>
            </View>
          ))}
        </Reveal>
      ) : null}
      <Reveal active={active} i={2} style={{ flexDirection: "row", gap: 12 }}>
        {stats.busiest_day ? (
          <View
            style={{
              flex: 1,
              borderRadius: 16,
              paddingHorizontal: 16,
              paddingVertical: 12,
              backgroundColor: chipFill(),
            }}
          >
            <Text
              className="font-serif"
              style={{ color: on, fontSize: 30, fontVariant: ["tabular-nums"] }}
            >
              {stats.busiest_day.count}
            </Text>
            <Text style={{ color: on, opacity: 0.7, fontSize: 12, marginTop: 4 }}>
              saves on {stats.busiest_day.label}
            </Text>
          </View>
        ) : null}
        <View
          style={{
            flex: 1,
            borderRadius: 16,
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: chipFill(),
          }}
        >
          <Text
            className="font-serif"
            style={{ color: on, fontSize: 30, fontVariant: ["tabular-nums"] }}
          >
            {stats.active_days}
          </Text>
          <Text style={{ color: on, opacity: 0.7, fontSize: 12, marginTop: 4 }}>
            active {stats.active_days === 1 ? "day" : "days"}
          </Text>
        </View>
      </Reveal>
    </View>
  );
}

// ─── Intro: the narrative opener + a couple of facts ─────────────────────────
export function IntroSlide({
  on,
  active,
  intro,
  facts,
}: {
  on: string;
  active: boolean;
  intro: string;
  facts: { label: string; value: string }[];
}) {
  const shown = facts.slice(0, 2);
  return (
    <View style={{ gap: 20 }}>
      <Reveal active={active} i={0}>
        <Text className="font-serif" style={{ color: on, fontSize: 28, lineHeight: 38 }}>
          {intro}
        </Text>
      </Reveal>
      {shown.length > 0 ? (
        <Reveal active={active} i={1} style={{ flexDirection: "row", flexWrap: "wrap", gap: 24 }}>
          {shown.map((f, i) => (
            <View key={i} style={{ gap: 2 }}>
              <Text
                className="uppercase"
                style={{ color: on, opacity: 0.7, fontSize: 11, letterSpacing: 1 }}
              >
                {f.label}
              </Text>
              <Text style={{ color: on, fontSize: 18, fontWeight: "500" }}>{f.value}</Text>
            </View>
          ))}
        </Reveal>
      ) : null}
    </View>
  );
}

// ─── Section: synthesized prose + source-note deep links ─────────────────────
export function SectionSlide({
  on,
  active,
  heading,
  body,
  items,
  onOpenNote,
}: {
  on: string;
  active: boolean;
  heading: string;
  body?: string;
  items: { title: string; summary: string; note_id: string }[];
  onOpenNote: (id: string) => void;
}) {
  const paragraphs = (body ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const rows = items.slice(0, 3);
  return (
    <View style={{ gap: 20 }}>
      <Kicker on={on} active={active}>
        {heading}
      </Kicker>
      {paragraphs.length > 0 ? (
        <Reveal active={active} i={1} style={{ gap: 12 }}>
          {paragraphs.map((p, i) => (
            <Text
              key={i}
              style={{
                color: on,
                fontSize: i === 0 ? 18 : 16,
                lineHeight: i === 0 ? 27 : 24,
                fontWeight: i === 0 ? "500" : "400",
              }}
            >
              {p}
            </Text>
          ))}
        </Reveal>
      ) : null}
      {rows.length > 0 ? (
        <Reveal active={active} i={2} style={{ gap: 8 }}>
          {rows.map((it, i) => (
            <Pressable
              key={`${it.note_id}-${i}`}
              accessibilityRole="button"
              onPress={() => onOpenNote(it.note_id)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                borderRadius: 16,
                paddingHorizontal: 14,
                paddingVertical: 10,
                backgroundColor: chipFill(pressed),
              })}
            >
              <Text numberOfLines={1} style={{ flex: 1, color: on, fontSize: 14 }}>
                <Text style={{ fontWeight: "500" }}>{it.title}</Text>
                {it.summary ? <Text style={{ opacity: 0.7 }}> · {it.summary}</Text> : null}
              </Text>
              <ArrowRight size={16} color={on} style={{ opacity: 0.6 }} />
            </Pressable>
          ))}
        </Reveal>
      ) : null}
    </View>
  );
}

// ─── No-story: narrative couldn't be written and there was no cache ──────────
export function NoStorySlide({ on, active }: { on: string; active: boolean }) {
  return (
    <View style={{ gap: 20 }}>
      <Reveal active={active} i={0}>
        <CalendarClock size={40} color={on} />
      </Reveal>
      <Reveal active={active} i={1}>
        <Text className="font-serif" style={{ color: on, fontSize: 28, lineHeight: 38 }}>
          We couldn't write your story today
        </Text>
      </Reveal>
      <Reveal active={active} i={2}>
        <Text style={{ color: on, opacity: 0.8, fontSize: 16, lineHeight: 24 }}>
          The numbers are all here. Check back later and we'll have the words too.
        </Text>
      </Reveal>
    </View>
  );
}

// ─── Finale: recap headline, deep-link chips, regenerate ─────────────────────
export function FinaleSlide({
  on,
  active,
  fallback,
  noteRefs,
  onOpenNote,
  onRegenerate,
  regenerating,
}: {
  on: string;
  active: boolean;
  fallback: boolean;
  noteRefs: NoteRef[];
  onOpenNote: (id: string) => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const chips = noteRefs.slice(0, 8);
  return (
    <View style={{ gap: 20 }}>
      <Reveal active={active} i={0}>
        <Text className="font-serif" style={{ color: on, fontSize: 36, lineHeight: 42 }}>
          {fallback ? "That was your recap" : "That was your week"}
        </Text>
      </Reveal>
      {chips.length > 0 ? (
        <Reveal
          active={active}
          i={1}
          style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
        >
          {chips.map((n) => {
            const title = n.title.length > 26 ? `${n.title.slice(0, 26).trimEnd()}…` : n.title;
            return (
              <Pressable
                key={n.id}
                accessibilityRole="button"
                onPress={() => onOpenNote(n.id)}
                style={({ pressed }) => ({
                  maxWidth: "100%",
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  backgroundColor: chipFill(pressed),
                })}
              >
                <Text numberOfLines={1} style={{ color: on, fontSize: 12 }}>
                  {title}
                </Text>
              </Pressable>
            );
          })}
        </Reveal>
      ) : null}
      <Reveal active={active} i={2} style={{ gap: 12, alignItems: "flex-start" }}>
        <Pressable
          accessibilityRole="button"
          onPress={onRegenerate}
          disabled={regenerating}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, opacity: regenerating ? 0.5 : 0.75 }}
        >
          <RotateCw size={14} color={on} />
          <Text style={{ color: on, fontSize: 14, textDecorationLine: "underline" }}>
            {regenerating ? "Regenerating…" : "Regenerate"}
          </Text>
        </Pressable>
      </Reveal>
    </View>
  );
}
