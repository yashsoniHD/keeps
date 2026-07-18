import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { MessageSquare, Plus, Trash2, X } from "lucide-react-native";
import { interopIcon } from "@/lib/note-meta";
import {
  deleteConversation,
  listConversations,
  type ConversationSummary,
} from "@/lib/api";

// className styling on SVG icons requires interop registration (see note-meta).
[MessageSquare, Plus, Trash2, X].forEach(interopIcon);

// ──────────────────────────── time grouping (port of web AskChat) ────────────────────────────

function toDate(ts: ConversationSummary["updated_at"]): Date | null {
  if (!ts) return null;
  if (typeof ts === "string") return new Date(ts);
  if (typeof ts === "object" && "seconds" in ts) return new Date(ts.seconds * 1000);
  return null;
}

function formatConvoTime(ts: ConversationSummary["updated_at"]): string {
  const d = toDate(ts);
  if (!d || isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(diff / 3_600_000);
  if (hrs < 24) return `${hrs}h ago`;
  if (hrs < 48) return "Yesterday";
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Row = { kind: "header"; label: string } | { kind: "convo"; convo: ConversationSummary };

function groupRows(convos: ConversationSummary[]): Row[] {
  const now = Date.now();
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfWeek = startOfToday - 6 * 86_400_000;
  const buckets: { label: string; items: ConversationSummary[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Last 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const c of convos) {
    const d = toDate(c.updated_at);
    const t = d ? d.getTime() : now - 1; // missing date → recent but not "today"
    if (t >= startOfToday) buckets[0].items.push(c);
    else if (t >= startOfYesterday) buckets[1].items.push(c);
    else if (t >= startOfWeek) buckets[2].items.push(c);
    else buckets[3].items.push(c);
  }
  const rows: Row[] = [];
  for (const b of buckets) {
    if (!b.items.length) continue;
    rows.push({ kind: "header", label: b.label });
    for (const c of b.items) rows.push({ kind: "convo", convo: c });
  }
  return rows;
}

// ──────────────────────────── the sheet ────────────────────────────

// A full-screen modal listing the user's saved conversations, grouped by recency. Tap a row to
// resume it; long-press to delete (confirmed). "New chat" starts fresh. Port of web AskChat's
// history drawer — long-press delete stands in for web's swipe-to-reveal (see deferred notes).
export function HistorySheet({
  visible,
  activeId,
  onClose,
  onResume,
  onNewChat,
}: {
  visible: boolean;
  activeId: string | null;
  onClose: () => void;
  onResume: (cid: string) => void;
  onNewChat: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true);
    listConversations()
      .then((c) => alive && setConversations(c))
      .catch(() => alive && setConversations([])) // a failed load just shows an empty list
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [visible]);

  const remove = (cid: string) => {
    Alert.alert("Delete chat", "This conversation will be permanently removed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setConversations((cs) => cs.filter((c) => c.id !== cid)); // optimistic
          try {
            await deleteConversation(cid);
          } catch {
            // leave it removed from the list; a reopen re-fetches truth
          }
        },
      },
    ]);
  };

  const rows = groupRows(conversations);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View className="flex-1 bg-paper">
        <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
          <View className="flex-row items-center gap-2 border-b border-border px-4 py-3">
            <Text className="flex-1 text-base font-semibold text-ink">Chat history</Text>
            <Pressable
              onPress={onNewChat}
              accessibilityRole="button"
              accessibilityLabel="New chat"
              className="flex-row items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 active:opacity-80"
            >
              <Plus size={14} className="text-ink-soft" />
              <Text className="text-xs text-ink-soft">New chat</Text>
            </Pressable>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close history"
              className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
            >
              <X size={18} className="text-ink-soft" />
            </Pressable>
          </View>

          {loading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator />
            </View>
          ) : conversations.length === 0 ? (
            <View className="flex-1 items-center justify-center gap-3 px-8">
              <View className="h-11 w-11 items-center justify-center rounded-2xl bg-accent">
                <MessageSquare size={20} className="text-ink-soft" />
              </View>
              <Text className="text-sm font-medium text-ink">No saved chats yet</Text>
              <Text className="text-center text-xs text-ink-soft">
                Your conversations will appear here.
              </Text>
            </View>
          ) : (
            <FlashList
              data={rows}
              keyExtractor={(r, i) => (r.kind === "header" ? `h-${r.label}` : r.convo.id) + i}
              getItemType={(r) => r.kind}
              contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
              renderItem={({ item }) => {
                if (item.kind === "header") {
                  return (
                    <Text className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-ink-soft">
                      {item.label}
                    </Text>
                  );
                }
                const c = item.convo;
                const active = c.id === activeId;
                return (
                  <Pressable
                    onPress={() => onResume(c.id)}
                    onLongPress={() => remove(c.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open chat: ${c.title}`}
                    className={`mb-0.5 flex-row items-center gap-2 rounded-xl px-3 py-2.5 active:opacity-80 ${
                      active ? "bg-accent" : "bg-card"
                    }`}
                  >
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm text-ink" numberOfLines={1}>
                        {c.title}
                      </Text>
                      {c.updated_at ? (
                        <Text className="text-[11px] text-ink-soft">
                          {formatConvoTime(c.updated_at)}
                        </Text>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={() => remove(c.id)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel="Delete chat"
                      className="h-8 w-8 items-center justify-center rounded-full active:opacity-70"
                    >
                      <Trash2 size={15} className="text-ink-soft" />
                    </Pressable>
                  </Pressable>
                );
              }}
            />
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}
