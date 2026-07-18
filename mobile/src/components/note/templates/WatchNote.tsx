import { View, Text } from "react-native";
import { Image } from "expo-image";
import { Clapperboard, Film, Tv, Star } from "lucide-react-native";
import type { Note, WatchProvider } from "@clipnote/shared";
import { noteAccent, type NoteAccent } from "@/lib/note-meta";
import { useAccentColors } from "../colors";

// One work in an entertainment note's `data.titles[]`. camelCase fields come from Gemini extraction
// (what the source said); snake_case fields are backend TMDB enrichment (looked up: poster,
// genres, per-region "where to watch" providers). Port of
// frontend/src/components/note/templates/WatchNote.tsx, flattened for mobile: no poster grid +
// dialog, each title is one full inline card.
interface TitleEntry {
  title?: string;
  year?: string | null;
  mediaType?: "movie" | "tv" | "unknown" | string;
  creator?: string | null;
  why?: string | null;
  overview?: string | null;
  tmdb_id?: number;
  poster_url?: string | null;
  genres?: string[];
  providers?: WatchProvider[];
  providers_region?: string;
}

interface WatchData {
  titles?: TitleEntry[];
  listTheme?: string;
}

function typeLabel(t: TitleEntry): string | null {
  if (t.mediaType === "tv") return "TV series";
  if (t.mediaType === "movie") return "Film";
  return null;
}

function metaLine(t: TitleEntry): string {
  return [typeLabel(t), t.year, t.creator].filter(Boolean).join(" · ");
}

// Subscription first, then rent, then buy — mirrors the web WatchProvider ordering comment.
const PROVIDER_ORDER: WatchProvider["type"][] = ["flatrate", "rent", "buy"];
const PROVIDER_GROUP_LABEL: Record<WatchProvider["type"], string> = {
  flatrate: "Stream",
  rent: "Rent",
  buy: "Buy",
};

// The colored fallback shown when a title has no TMDB poster: the note's accent wash plus a
// media-type glyph, so a coverless title still reads as a poster and never leaves a blank frame.
function PosterFallback({ t, accent, iconColor }: { t: TitleEntry; accent: NoteAccent; iconColor: string }) {
  const Icon = t.mediaType === "tv" ? Tv : t.mediaType === "movie" ? Film : Clapperboard;
  return (
    <View className={`flex-1 items-center justify-center gap-2 ${accent.soft}`}>
      <Icon size={28} color={iconColor} />
      <Text className="px-2 text-center font-serif text-xs text-ink" numberOfLines={3}>
        {t.title}
      </Text>
    </View>
  );
}

function Poster({ t, accent, iconColor }: { t: TitleEntry; accent: NoteAccent; iconColor: string }) {
  return (
    <View
      className="overflow-hidden rounded-xl border border-border bg-card"
      style={{ width: 96, aspectRatio: 2 / 3 }}
    >
      {t.poster_url ? (
        <Image source={{ uri: t.poster_url }} style={{ flex: 1 }} contentFit="cover" />
      ) : (
        <PosterFallback t={t} accent={accent} iconColor={iconColor} />
      )}
    </View>
  );
}

// "Where to watch" — providers grouped by type (Stream / Rent / Buy), each a logo + name chip. The
// "Streaming data by JustWatch" attribution is MANDATORY wherever providers render (project rule).
function ProvidersBlock({
  t,
  accent,
  iconColor,
}: {
  t: TitleEntry;
  accent: NoteAccent;
  iconColor: string;
}) {
  const providers = t.providers ?? [];
  if (providers.length === 0) return null;

  const groups = PROVIDER_ORDER.map((type) => ({
    type,
    items: providers.filter((p) => p.type === type),
  })).filter((g) => g.items.length > 0);
  if (groups.length === 0) return null;

  return (
    <View className="gap-3 border-t border-border pt-4">
      <Text className="text-xs font-medium uppercase tracking-wider text-ink-soft">
        {t.providers_region ? `Where to watch · ${t.providers_region}` : "Where to watch"}
      </Text>
      {groups.map((g) => (
        <View key={g.type} className="gap-2">
          <Text className="text-xs text-ink-soft">{PROVIDER_GROUP_LABEL[g.type]}</Text>
          <View className="flex-row flex-wrap gap-2">
            {g.items.map((p, i) => (
              <View
                key={`${p.name}-${i}`}
                className="flex-row items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1"
              >
                {p.logo_url ? (
                  <Image
                    source={{ uri: p.logo_url }}
                    style={{ width: 18, height: 18, borderRadius: 4 }}
                    contentFit="cover"
                  />
                ) : (
                  <Star size={12} color={iconColor} />
                )}
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

function TitleCard({
  t,
  accent,
  iconColor,
}: {
  t: TitleEntry;
  accent: NoteAccent;
  iconColor: string;
}) {
  const meta = metaLine(t);
  const genres = t.genres ?? [];
  const label = typeLabel(t);
  return (
    <View className="gap-4 rounded-2xl border border-border bg-card p-4">
      <View className="flex-row gap-4">
        <Poster t={t} accent={accent} iconColor={iconColor} />
        <View className="min-w-0 flex-1 gap-2">
          <Text className="font-serif text-lg leading-tight text-ink">{t.title}</Text>
          <View className="flex-row flex-wrap items-center gap-2">
            {label && (
              <Text className={`rounded-full px-2 py-0.5 text-xs ${accent.chip}`}>{label}</Text>
            )}
            {(t.year || t.creator) && (
              <Text className="text-sm text-ink-soft">
                {[t.year, t.creator].filter(Boolean).join(" · ")}
              </Text>
            )}
          </View>
          {genres.length > 0 && (
            <View className="flex-row flex-wrap gap-1.5">
              {genres.map((g, i) => (
                <Text
                  key={i}
                  className="rounded-full border border-border px-2 py-0.5 text-xs text-ink-soft"
                >
                  {g}
                </Text>
              ))}
            </View>
          )}
        </View>
      </View>

      {t.overview && (
        <Text className="leading-relaxed text-ink-soft" numberOfLines={5}>
          {t.overview}
        </Text>
      )}

      {t.why && (
        <View className={`gap-1.5 rounded-2xl border border-border p-4 ${accent.soft}`}>
          <View className="flex-row items-center gap-2">
            <Star size={16} color={iconColor} />
            <Text className="text-sm font-medium text-ink">Why it&rsquo;s worth watching</Text>
          </View>
          <Text className="leading-relaxed text-ink">{t.why}</Text>
        </View>
      )}

      <ProvidersBlock t={t} accent={accent} iconColor={iconColor} />
    </View>
  );
}

// Renders an entertainment note as a stack of rich title cards (poster + meta + genres + overview +
// why + "where to watch"). Unlike the web grid+dialog, everything is inline for a phone.
export function WatchNote({ note }: { note: Note }) {
  const data = note.data as WatchData;
  const accent = noteAccent(note.content_type);
  const { main } = useAccentColors(note.content_type);
  const titles = (data.titles ?? []).filter(
    (t): t is TitleEntry => Boolean(t && typeof t === "object" && t.title),
  );

  return (
    <View className="gap-6">
      {data.listTheme && titles.length > 1 && (
        <Text className="text-sm uppercase tracking-wider text-ink-soft">{data.listTheme}</Text>
      )}
      {titles.map((t, i) => (
        <TitleCard key={`${t.title}-${i}`} t={t} accent={accent} iconColor={main} />
      ))}
    </View>
  );
}
