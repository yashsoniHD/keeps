import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import * as Linking from "expo-linking";
import {
  MapPin,
  Map as MapIcon,
  Star,
  Clock,
  Wallet,
  Sparkles,
  Lightbulb,
  Utensils,
  ChevronDown,
  CalendarCheck,
  ShoppingBag,
  Phone,
  Globe,
  Camera,
  type LucideIcon,
} from "lucide-react-native";
import type { Note, PlaceAction } from "@clipnote/shared";
import { noteAccent, type NoteAccent } from "@/lib/note-meta";
import { useAccentColors } from "../colors";
import { SectionHeader } from "../SectionHeader";
import { FactsBlock, type Fact } from "../FactsBlock";
import { DataTable, type TableData } from "../DataTable";
import { SmartImage } from "../SmartImage";
import { VenuesMap } from "../VenuesMap";

// One venue in a place note. camelCase fields match the backend `place` venues[] schema (what the
// source said); snake_case fields are backend Google-Places enrichment (looked up: photo, coords,
// live rating, hours, links). Port of frontend/src/components/note/templates/PlaceNote.tsx.
interface Venue {
  name?: string;
  location?: string;
  city?: string;
  category?: string;
  cuisine?: string;
  priceForTwo?: string;
  priceRange?: string; // legacy
  rating?: string | number; // source string, or Google numeric after enrichment
  timings?: string;
  mustTry?: string[];
  goodFor?: string[];
  facts?: Fact[]; // legacy
  highlights?: string[];
  tips?: string[];
  why?: string;
  // enrichment (Google Places)
  formatted_address?: string | null;
  lat?: number | null;
  lng?: number | null;
  user_rating_count?: number | null;
  price_level?: string | null;
  opening_hours?: string[];
  photo_url?: string | null;
  action_links?: PlaceAction[];
}

interface PlaceData {
  venues?: Venue[];
  listTheme?: string;
  facts?: Fact[];
  table?: TableData;
  // legacy single-venue fields
  name?: string;
  location?: string;
  category?: string;
  priceRange?: string;
  rating?: string;
  timings?: string;
  highlights?: string[];
  tips?: string[];
}

// Order / Reserve are intentionally not surfaced (mirrors the web ActionRow HIDDEN_KINDS), so
// existing enriched notes drop them without a data migration.
const HIDDEN_KINDS = new Set<PlaceAction["kind"]>(["order", "reserve"]);
const ACTION_ICON: Record<PlaceAction["kind"], LucideIcon> = {
  directions: MapPin,
  reserve: CalendarCheck,
  order: ShoppingBag,
  call: Phone,
  website: Globe,
  instagram: Camera, // lucide-react-native dropped brand glyphs; Camera stands in for Instagram
};

// The region-aware action row on an enriched venue (Directions / Call / Website / Instagram). The
// backend builds `action_links`; this renders them as tappable pills opening via expo-linking.
function ActionRow({ actions, iconColor }: { actions?: PlaceAction[]; iconColor: string }) {
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
            <Icon size={14} color={iconColor} />
            <Text className="text-xs text-ink-soft">{a.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Google's opening_hours weekday lines look like "Friday: 9:00 AM – 11:00 PM". Pull out today's
// hours for the compact disclosure summary; null when the format doesn't match. Port of web.
function todaysHours(hours: string[]): string | null {
  const day = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const line = hours.find((h) => h.startsWith(day));
  if (!line) return null;
  const rest = line.slice(day.length).replace(/^:\s*/, "").trim();
  return rest || null;
}

function ratingText(v: Venue): string | null {
  if (v.rating == null || v.rating === "") return null;
  return typeof v.rating === "number" && v.user_rating_count
    ? `${v.rating} (${v.user_rating_count.toLocaleString()})`
    : String(v.rating);
}

function VenueBlock({
  v,
  accent,
  accentMain,
  showName,
  index,
}: {
  v: Venue;
  accent: NoteAccent;
  accentMain: string;
  showName: boolean;
  index: number;
}) {
  const [hoursOpen, setHoursOpen] = useState(false);
  const rating = ratingText(v);
  const price = v.priceForTwo || v.priceRange || v.price_level;
  const liveHours = (v.opening_hours?.length ?? 0) > 0;
  const today = liveHours ? todaysHours(v.opening_hours!) : null;

  const ratingLine = rating ? (
    <View className="flex-row items-center gap-1.5">
      <Star size={14} color={accentMain} fill={accentMain} />
      <Text className="text-sm font-medium text-ink">{rating}</Text>
    </View>
  ) : null;

  return (
    <View className="gap-5">
      {/* Numbered header — the chip number matches this venue's map pin. */}
      <View className="gap-3">
        {v.name && (
          <View className="flex-row items-center gap-3">
            {showName && (
              <View
                className={`h-8 w-8 items-center justify-center rounded-full ${accent.dot}`}
              >
                <Text className="text-sm font-semibold text-paper">{index + 1}</Text>
              </View>
            )}
            <Text className="flex-1 font-serif text-2xl text-ink">{v.name}</Text>
          </View>
        )}

        <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1.5">
          {ratingLine}
          {(v.location || v.formatted_address) && (
            <View className="flex-row items-center gap-1.5">
              <MapPin size={14} color={accentMain} />
              <Text className="text-sm text-ink">{v.location || v.formatted_address}</Text>
            </View>
          )}
          {(v.category || v.cuisine) && (
            <Text className="text-sm text-ink-soft">
              {[v.category, v.cuisine].filter(Boolean).join(" · ")}
            </Text>
          )}
          {price && (
            <View className="flex-row items-center gap-1.5">
              <Wallet size={14} color={accentMain} />
              <Text className="text-sm text-ink-soft">{price}</Text>
            </View>
          )}
          {v.timings && !liveHours && (
            <View className="flex-row items-center gap-1.5">
              <Clock size={14} color={accentMain} />
              <Text className="text-sm text-ink-soft">{v.timings}</Text>
            </View>
          )}
        </View>
      </View>

      {v.photo_url && (
        <SmartImage uri={v.photo_url} />
      )}

      <ActionRow actions={v.action_links} iconColor={accentMain} />

      {/* Live hours as a compact disclosure: today's hours in the summary, the full week on tap. */}
      {liveHours && (
        <View>
          <Pressable
            onPress={() => setHoursOpen((o) => !o)}
            className="flex-row items-center gap-1.5 active:opacity-70"
          >
            <Clock size={14} color={accentMain} />
            <Text className="text-sm text-ink-soft">
              {today ? `Today · ${today}` : "Opening hours"}
            </Text>
            <ChevronDown size={14} color={accentMain} />
          </Pressable>
          {hoursOpen && (
            <View className="mt-2 gap-1 pl-5">
              {v.opening_hours!.map((h, i) => (
                <Text key={i} className="text-sm text-ink-soft">
                  {h}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      <FactsBlock facts={v.facts} accent={accent} />

      {v.mustTry && v.mustTry.length > 0 && (
        <View>
          <SectionHeader icon={Utensils} iconColor={accentMain}>
            Must try
          </SectionHeader>
          <View className="mt-3 flex-row flex-wrap gap-2">
            {v.mustTry.map((m, i) => (
              <Text key={i} className={`rounded-full px-2.5 py-1 text-sm ${accent.chip}`}>
                {m}
              </Text>
            ))}
          </View>
        </View>
      )}

      {v.why && <Text className="leading-relaxed text-ink">{v.why}</Text>}

      {v.highlights && v.highlights.length > 0 && (
        <View>
          <SectionHeader icon={Sparkles} iconColor={accentMain}>
            Highlights
          </SectionHeader>
          <View className="mt-4 gap-3">
            {v.highlights.map((item, i) => (
              <View key={i} className="flex-row items-start gap-3">
                <View className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                <Text className="flex-1 leading-relaxed text-ink">{item}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {v.goodFor && v.goodFor.length > 0 && (
        <View className="flex-row flex-wrap gap-2">
          {v.goodFor.map((g, i) => (
            <Text
              key={i}
              className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-ink-soft"
            >
              {g}
            </Text>
          ))}
        </View>
      )}

      {v.tips && v.tips.length > 0 && (
        <View className="rounded-2xl border border-border bg-card p-5">
          <SectionHeader icon={Lightbulb} iconColor={accentMain}>
            Tips
          </SectionHeader>
          <View className="mt-3 gap-2.5">
            {v.tips.map((tip, i) => (
              <View key={i} className="flex-row items-start gap-3">
                <View className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                <Text className="flex-1 text-ink">{tip}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

// Renders a place note. New notes carry `data.venues[]`; legacy notes carry a single venue's
// fields at the top level — normalized here. Port of the web PlaceNote.
export function PlaceNote({ note }: { note: Note }) {
  const data = note.data as PlaceData;
  const accent = noteAccent(note.content_type);
  const { main } = useAccentColors(note.content_type);

  const venues: Venue[] =
    Array.isArray(data.venues) && data.venues.length > 0
      ? data.venues
      : [
          {
            name: data.name,
            location: data.location,
            category: data.category,
            priceRange: data.priceRange,
            rating: data.rating,
            timings: data.timings,
            facts: data.facts,
            highlights: data.highlights,
            tips: data.tips,
          },
        ];

  const multi = venues.length > 1;

  return (
    <View className="gap-10">
      {data.listTheme && multi && (
        <Text className="text-sm uppercase tracking-wider text-ink-soft">{data.listTheme}</Text>
      )}

      {/* Note-level at-a-glance facts about the list itself (multi-venue roundups only). */}
      {multi && <FactsBlock facts={data.facts} accent={accent} />}
      {multi && data.table && <DataTable table={data.table} accent={accent} />}

      {venues.map((v, i) => (
        <View key={i} className={i > 0 ? "border-t border-border pt-10" : undefined}>
          <VenueBlock v={v} accent={accent} accentMain={main} showName={multi} index={i} />
        </View>
      ))}

      {/* Map below the list so its numbered pins reference venues already read; VenuesMap itself
          hides unless at least two venues geocoded. */}
      <VenuesMapSection venues={venues} accentMain={main} />
    </View>
  );
}

// Header + map, or nothing when fewer than two venues geocoded. Split out so the "On the map"
// heading never renders above a hidden map.
function VenuesMapSection({ venues, accentMain }: { venues: Venue[]; accentMain: string }) {
  const geocoded = venues.filter(
    (v) => typeof v.lat === "number" && typeof v.lng === "number",
  ).length;
  if (geocoded < 2) return null;
  return (
    <View className="gap-4">
      <SectionHeader icon={MapIcon} iconColor={accentMain}>
        On the map
      </SectionHeader>
      <VenuesMap venues={venues} />
    </View>
  );
}
