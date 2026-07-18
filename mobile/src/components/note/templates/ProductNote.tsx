import { View, Text, Pressable } from "react-native";
import * as Linking from "expo-linking";
import { Star, Check, X, ExternalLink, type LucideIcon } from "lucide-react-native";
import type { Note } from "@clipnote/shared";
import { noteAccent, type NoteAccent } from "@/lib/note-meta";
import { SmartImage } from "../SmartImage";
import { useAccentColors, useTokens } from "../colors";

interface ProductData {
  price?: string;
  price_amount?: number; // enriched by services/enrich.py
  currency?: string; //     "
  brand?: string;
  rating?: string | number;
  buyUrl?: string;
  specs?: { label: string; value: string }[];
  pros?: string[];
  cons?: string[];
  verdict?: string;
}

// Pull the first number out of "4.5", "4.5/5", "Rated 4 stars" → 4.5 (0 if none).
function parseRating(raw: string | number | undefined): number {
  if (raw == null) return 0;
  if (typeof raw === "number") return raw;
  const m = raw.match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}

// Prefer the source-said price string; fall back to the enriched amount + currency when the
// scrape only yielded the parsed pair (web renders `data.price` only, but mobile keeps the
// note useful when just the enriched fields survive).
function displayPrice(data: ProductData): string | undefined {
  if (data.price) return data.price;
  if (typeof data.price_amount === "number") {
    return data.currency ? `${data.currency} ${data.price_amount}` : String(data.price_amount);
  }
  return undefined;
}

// Port of frontend/src/components/note/templates/ProductNote.tsx. Web's cover | details
// two-column grid stacks vertically on a phone; the pros/cons two-column grid likewise stacks.
export function ProductNote({ note }: { note: Note }) {
  const data = note.data as ProductData;
  const accent = noteAccent(note.content_type);
  const { main, on } = useAccentColors(note.content_type);
  const t = useTokens();
  const rating = parseRating(data.rating);
  const price = displayPrice(data);
  const buyUrl = data.buyUrl ?? note.source_url;

  return (
    <View className="gap-8">
      {note.cover_image_url && (
        <View className="rounded-3xl border border-border bg-card p-4">
          <SmartImage uri={note.cover_image_url} rounded={false} />
        </View>
      )}

      <View>
        {data.brand && (
          <Text className="text-sm uppercase tracking-wider text-ink-soft">{data.brand}</Text>
        )}

        <View className="mt-3 flex-row flex-wrap items-baseline gap-x-4 gap-y-2">
          {price && <Text className="font-serif text-4xl text-ink">{price}</Text>}
          {data.rating != null && data.rating !== "" && (
            <View className="flex-row items-center gap-1.5">
              {rating > 0 && (
                <View className="flex-row">
                  {Array.from({ length: 5 }).map((_, i) => {
                    const filled = i < Math.round(rating);
                    return (
                      <Star
                        key={i}
                        size={16}
                        color={filled ? main : t.border}
                        fill={filled ? main : "transparent"}
                      />
                    );
                  })}
                </View>
              )}
              <Text className="text-sm text-ink-soft">{String(data.rating)}</Text>
            </View>
          )}
        </View>

        {buyUrl && (
          <Pressable
            onPress={() => Linking.openURL(buyUrl).catch(() => {})}
            className={`mt-5 flex-row items-center justify-center gap-2 rounded-full px-5 py-3 active:opacity-90 ${accent.dot}`}
          >
            <Text className={`text-sm font-medium ${accent.on}`}>
              View on {note.source_domain}
            </Text>
            <ExternalLink size={16} color={on} />
          </Pressable>
        )}

        {data.specs && data.specs.length > 0 && (
          <View className="mt-7 rounded-2xl border border-border bg-card">
            {data.specs.map((s, i) => (
              <View
                key={i}
                className={`flex-row items-baseline justify-between gap-4 px-4 py-3 ${i > 0 ? "border-t border-border" : ""}`}
              >
                <Text className="text-sm text-ink-soft">{s.label}</Text>
                <Text className="flex-1 text-right text-sm text-ink">{s.value}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {((data.pros && data.pros.length > 0) || (data.cons && data.cons.length > 0)) && (
        <View className="gap-5">
          {data.pros && data.pros.length > 0 && (
            <ProsCons title="Pros" items={data.pros} icon={Check} tone="positive" />
          )}
          {data.cons && data.cons.length > 0 && (
            <ProsCons title="Cons" items={data.cons} icon={X} tone="negative" />
          )}
        </View>
      )}

      {data.verdict && (
        <View className={`rounded-2xl border border-border p-5 ${accent.soft}`}>
          <Text className={`text-xs uppercase tracking-wider ${accent.text}`}>Verdict</Text>
          <Text className="mt-1 font-serif text-xl leading-snug text-ink">{data.verdict}</Text>
        </View>
      )}
    </View>
  );
}

function ProsCons({
  title,
  items,
  icon: Icon,
  tone,
}: {
  title: string;
  items: string[];
  icon: LucideIcon;
  tone: "positive" | "negative";
}) {
  const t = useTokens();
  // Sage (place) reads as "good", terracotta (recipe) as "caution" — both real palette tokens,
  // so they stay on-theme rather than introducing raw green/red.
  const badgeClass =
    tone === "positive" ? "bg-place-soft" : "bg-recipe-soft";
  const iconColor = tone === "positive" ? t["place-chip"] : t["recipe-chip"];
  return (
    <View className="rounded-2xl border border-border bg-card p-5">
      <Text className="font-serif text-xl text-ink">{title}</Text>
      <View className="mt-3 gap-2">
        {items.map((item, i) => (
          <View key={i} className="flex-row items-start gap-2.5">
            <View
              className={`mt-0.5 h-5 w-5 shrink-0 items-center justify-center rounded-full ${badgeClass}`}
            >
              <Icon size={12} color={iconColor} />
            </View>
            <Text className="flex-1 text-ink">{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
