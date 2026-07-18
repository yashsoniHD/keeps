import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { ChevronRight, Sparkles } from "lucide-react-native";
import type { CollectionDigest, Note } from "@clipnote/shared";
import { interopIcon, type NoteAccent } from "@/lib/note-meta";
import { StatGrid } from "@/components/note/StatGrid";
import { NoteMarkdown } from "@/components/note/Markdown";

[ChevronRight, Sparkles].forEach(interopIcon);

// One deep-linking row in a section's supporting list: index, title + summary on one line.
// Port of the web CollectionDigest's DigestEntryRow.
function DigestEntryRow({
  index,
  noteId,
  title,
  summary,
}: {
  index: number;
  noteId: string;
  title: string;
  summary: string;
}) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/note/${noteId}`)}
      className="flex-row items-center gap-3 px-3.5 py-2 active:opacity-70"
    >
      <Text className="w-5 text-right text-[10px] tabular-nums text-ink-soft/40">
        {String(index + 1).padStart(2, "0")}
      </Text>
      <Text className="flex-1 text-xs leading-snug text-ink" numberOfLines={1}>
        <Text className="font-medium text-ink">{title}</Text>
        {summary ? <Text className="text-ink-soft"> · {summary}</Text> : null}
      </Text>
      <ChevronRight size={12} className="text-ink-soft" />
    </Pressable>
  );
}

// The quiet "From:" row grounding a section in the notes it was synthesized from — favicon +
// truncated title chips, each a deep link. Ids with no matching live note render nothing.
function DigestSectionSources({ ids, notesById }: { ids: string[]; notesById: Map<string, Note> }) {
  const router = useRouter();
  const matched = ids.map((id) => notesById.get(id)).filter((n): n is Note => !!n);
  if (matched.length === 0) return null;
  return (
    <View className="mt-3 flex-row flex-wrap items-center gap-1.5 px-1">
      <Text className="text-[11px] uppercase tracking-wider text-ink-soft/50">From</Text>
      {matched.map((n) => {
        const title = n.title.length > 24 ? `${n.title.slice(0, 24).trimEnd()}…` : n.title;
        return (
          <Pressable
            key={n.id}
            onPress={() => router.push(`/note/${n.id}`)}
            className="flex-row items-center gap-1.5 rounded-full border border-border/70 bg-card px-2.5 py-1 active:opacity-70"
          >
            {n.source_domain ? (
              <Image
                source={{ uri: `https://www.google.com/s2/favicons?domain=${n.source_domain}&sz=32` }}
                style={{ width: 12, height: 12, borderRadius: 2 }}
                contentFit="contain"
              />
            ) : null}
            <Text className="text-xs text-ink-soft" numberOfLines={1}>
              {title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// The "living view" composed from a collection's member notes — a serif lede, an optional
// at-a-glance fact row, and sections of synthesized prose + a supporting note list + citations.
// Port of frontend/src/components/collection/CollectionDigest.tsx. `notes` is the collection's
// live member set so a section's `source_note_ids` resolve to real titles/links with no
// second fetch.
export function CollectionDigestView({
  digest,
  notes,
  updating = false,
  accent,
}: {
  digest: CollectionDigest;
  notes: Note[];
  updating?: boolean;
  accent?: NoteAccent | null;
}) {
  const notesById = useMemo(() => new Map(notes.map((n) => [n.id, n] as const)), [notes]);

  return (
    <View className="gap-6">
      {updating && (
        <View className="flex-row items-center justify-end gap-1.5">
          <Sparkles size={12} className="text-ink-soft" />
          <Text className="text-[11px] text-ink-soft">Updating…</Text>
        </View>
      )}

      <Text className="font-serif text-2xl leading-snug text-ink">{digest.intro}</Text>

      {digest.facts.length > 0 && (
        <StatGrid
          stats={digest.facts.map((f) => ({ label: f.label, value: f.value }))}
          accent={
            accent ?? {
              dot: "bg-ink",
              chip: "bg-muted text-ink-soft",
              text: "text-ink-soft",
              soft: "bg-muted",
              border: "border-border",
              on: "text-paper",
              wash: "border-border bg-secondary/70",
            }
          }
        />
      )}

      <View className="gap-7">
        {digest.sections.map((sec, i) => {
          const items = sec.items ?? [];
          const sourceIds = sec.source_note_ids ?? [];
          return (
            <View key={i}>
              <View className="mb-2.5 flex-row items-center gap-2 px-1">
                <View className={`h-1.5 w-1.5 rounded-full ${accent ? accent.dot : "bg-ink-soft/40"}`} />
                <Text className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                  {sec.heading}
                </Text>
                {items.length > 0 && (
                  <Text className="text-[11px] tabular-nums text-ink-soft/50">{items.length}</Text>
                )}
              </View>
              {sec.body ? <NoteMarkdown>{sec.body}</NoteMarkdown> : null}
              {items.length > 0 && (
                <View className={sec.body ? "mt-3" : ""}>
                  <View className="divide-y divide-border/50 rounded-2xl border border-border/70 bg-card/60">
                    {items.map((item, j) => (
                      <DigestEntryRow
                        key={j}
                        index={j}
                        noteId={item.note_id}
                        title={item.title}
                        summary={item.summary}
                      />
                    ))}
                  </View>
                </View>
              )}
              {sourceIds.length > 0 && (
                <DigestSectionSources ids={sourceIds} notesById={notesById} />
              )}
            </View>
          );
        })}
      </View>

      {digest.coverage ? (
        <Text className="text-[11px] text-ink-soft/70">{digest.coverage}</Text>
      ) : null}
    </View>
  );
}
