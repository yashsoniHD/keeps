import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AlertCircle, ArrowUp, Clock, Sparkles } from "lucide-react-native";
import { interopIcon } from "@/lib/note-meta";
import { useTokens } from "@/components/note/colors";
import { watchJob } from "@/lib/firestore";
import {
  askDeep,
  askStream,
  ApiError,
  getConversation,
  type ChatMessage,
} from "@/lib/api";
import { AskMarkdown } from "@/components/ask/AskMarkdown";
import { ArtifactCard } from "@/components/ask/ArtifactCard";
import { CitationChip } from "@/components/ask/CitationChip";
import { HistorySheet } from "@/components/ask/HistorySheet";

// className styling on SVG icons requires interop registration (see note-meta).
[AlertCircle, ArrowUp, Clock, Sparkles].forEach(interopIcon);

// Heuristic: route obviously-heavy, whole-corpus synthesis requests to the background (deep)
// worker instead of the bounded interactive stream. Conservative on purpose. Port of web AskChat.
const DEEP_PATTERNS = [
  /\b(all|every|each)\s+(my|of\s+my|the)\b/i,
  /\bacross\s+(all|my|the)\b/i,
  /\b(compile|consolidate|synthesize|cross-reference)\b/i,
  /\b(go|look)\s+through\s+(all|my|every)\b/i,
  /\breview\s+all\b/i,
  /\bPRD\b/,
];
function looksHeavy(question: string): boolean {
  return DEEP_PATTERNS.some((re) => re.test(question));
}

const SLOW_PHRASES = [
  "Thinking…",
  "Working on it…",
  "Digging through your notes…",
  "Almost there…",
];

const EXAMPLES = [
  "Summarize today's notes",
  "Plan a trip from my notes",
  "Compare my saved products",
];

// The Ask AI chat surface: a corpus-wide, notes-grounded conversation. Port of web
// frontend/src/components/ask/AskChat.tsx (streaming answers, tool/agent status ticker, grounded
// citations, consolidated artifacts, deep background tasks, conversation history). State is local
// to this mounted tab screen (web owned it in an ask-context so the panel could unmount; the tab
// stays mounted here, so local state persists across tab switches — see report).
export default function AskScreen() {
  const router = useRouter();
  const t = useTokens();
  const { q: seed } = useLocalSearchParams<{ q?: string }>();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null); // live agent activity line
  const [slowLabel, setSlowLabel] = useState<string | null>(null); // rotating "Thinking…"
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const listRef = useRef<FlashListRef<ChatMessage>>(null);
  // Deep-task subscriptions live OUTSIDE React's effect lifecycle on purpose: an effect keyed
  // on [messages] tears its listeners down on every keystroke/token of later chat, silently
  // dropping the "Done. View the note" flip (the pending card invites the user to keep
  // chatting, which is exactly what killed it). Job id → unsubscribe; cleared on unmount,
  // new chat, and conversation switch.
  const jobUnsubs = useRef<Map<string, () => void>>(new Map());

  const clearJobWatchers = useCallback(() => {
    jobUnsubs.current.forEach((u) => u());
    jobUnsubs.current.clear();
  }, []);

  const subscribeJob = useCallback((jid: string) => {
    if (jobUnsubs.current.has(jid)) return;
    const unsub = watchJob(jid, (job) => {
      if (job.status === "completed") {
        setMessages((ms) =>
          ms.map((x) =>
            x.jobId === jid ? { ...x, pending: false, resultNoteId: job.note_id ?? null } : x,
          ),
        );
      } else if (job.status === "failed") {
        setMessages((ms) =>
          ms.map((x) => (x.jobId === jid ? { ...x, pending: false, failed: true } : x)),
        );
      } else {
        return; // still running — keep listening
      }
      jobUnsubs.current.get(jid)?.();
      jobUnsubs.current.delete(jid);
    });
    jobUnsubs.current.set(jid, unsub);
  }, []);
  const seedSent = useRef<string | null>(null);
  const sendGate = useRef(false); // synchronous double-send gate (see send())

  // TODO(v1): the reference-note picker (askStream's selectedNoteIds) and web's focal-note
  // scoping (noteId) are deferred — the tab is always corpus-wide for now.
  const selectedNoteIds: string[] = [];
  const noteId: string | undefined = undefined;

  // Auto-scroll to the newest content as it streams in.
  useEffect(() => {
    const id = setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [messages, sending, status]);

  // Tear down any live deep-task listeners only when the screen truly unmounts.
  useEffect(() => clearJobWatchers, [clearJobWatchers]);

  // Rotating "Thinking…" copy once a streamed reply is slow to start (no token/tool status yet).
  useEffect(() => {
    if (!sending) {
      setSlowLabel(null);
      return;
    }
    let rotate: ReturnType<typeof setInterval> | undefined;
    let i = 0;
    const start = setTimeout(() => {
      setSlowLabel(SLOW_PHRASES[0]);
      rotate = setInterval(() => {
        i = (i + 1) % SLOW_PHRASES.length;
        setSlowLabel(SLOW_PHRASES[i]);
      }, 3500);
    }, 1800);
    return () => {
      clearTimeout(start);
      if (rotate) clearInterval(rotate);
    };
  }, [sending]);

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      // `sending` alone races: a same-frame double tap (or onPress + onSubmitEditing) reads the
      // stale closure value and starts two streams into one bubble. The ref gate is synchronous.
      if (!question || sending || sendGate.current) return;
      sendGate.current = true;
      try {
        await sendInner(question);
      } finally {
        sendGate.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, sending, conversationId, noteId, selectedNoteIds],
  );

  const sendInner = useCallback(
    async (question: string) => {
      const history = messages.map(({ role, text }) => ({ role, text })).slice(-10);

      // Heavy whole-corpus jobs run in the background (Cloud Tasks worker) and write a note we
      // surface when it completes — the chat stays usable meanwhile.
      if (looksHeavy(question)) {
        const base = messages;
        setMessages([
          ...base,
          { role: "user", text: question },
          { role: "assistant", text: "", pending: true },
        ]);
        setInput("");
        setError(null);
        try {
          const { job_id } = await askDeep(question, noteId, selectedNoteIds);
          setMessages((m) => {
            const last = m[m.length - 1];
            if (!last || last.role !== "assistant") return m;
            return [...m.slice(0, -1), { ...last, jobId: job_id }];
          });
          subscribeJob(job_id);
        } catch (e) {
          setError(
            e instanceof ApiError ? e.message : "Couldn't start the task. Please try again.",
          );
          setMessages((m) => (m[m.length - 1]?.pending ? m.slice(0, -1) : m));
        }
        return;
      }

      // Push the user turn + an empty assistant turn we mutate in place as deltas stream in.
      setMessages([...messages, { role: "user", text: question }, { role: "assistant", text: "" }]);
      setInput("");
      setError(null);
      setStatus(null);
      setSending(true);

      const patchLast = (patch: Partial<ChatMessage>) =>
        setMessages((m) => {
          if (!m.length) return m;
          const last = m[m.length - 1];
          if (last.role !== "assistant") return m;
          return [...m.slice(0, -1), { ...last, ...patch }];
        });
      const appendDelta = (text: string) =>
        setMessages((m) => {
          if (!m.length) return m;
          const last = m[m.length - 1];
          if (last.role !== "assistant") return m;
          return [...m.slice(0, -1), { ...last, text: last.text + text }];
        });

      let sawContent = false;
      let sawError = false;
      try {
        await askStream(question, history, noteId, selectedNoteIds, conversationId, {
          onConversation: (id) => setConversationId(id),
          onStatus: (s) => setStatus(s),
          onDelta: (text) => {
            sawContent = true;
            setStatus(null); // first token clears the activity line
            appendDelta(text);
          },
          onCitations: (citations) => patchLast({ citations }),
          onArtifact: (artifact) => {
            sawContent = true;
            patchLast({ artifact });
          },
          onCoverage: (coverage) => patchLast({ coverage }),
          onSavedNote: (savedId) => {
            sawContent = true;
            patchLast({ saved_note_id: savedId });
          },
          onError: (message) => {
            sawError = true;
            setError(message);
          },
        });
      } catch (e) {
        sawError = true;
        setError(e instanceof ApiError ? e.message : "Couldn't get an answer. Please try again.");
      } finally {
        setSending(false);
        setStatus(null);
        // Drop a trailing assistant message that never produced any content (hard error).
        setMessages((m) => {
          const last = m[m.length - 1];
          if (last && last.role === "assistant" && !last.text && !last.artifact) {
            return m.slice(0, -1);
          }
          return m;
        });
        if (!sawContent && !sawError) {
          setError("I couldn't put together an answer. Please try again.");
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, conversationId, noteId, selectedNoteIds],
  );

  // A seed (from the search screen → /ask?q=…) is sent once on mount.
  useEffect(() => {
    if (seed && seedSent.current !== seed) {
      seedSent.current = seed;
      void send(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const startNewChat = () => {
    setMessages([]);
    setConversationId(null);
    clearJobWatchers();
    setError(null);
    setHistoryOpen(false);
  };

  const resumeConversation = async (cid: string) => {
    try {
      const c = await getConversation(cid);
      setMessages(
        (c.messages ?? []).map((m) => ({
          role: m.role,
          text: m.text,
          citations: m.citations,
          artifact: m.artifact ?? null,
          saved_note_id: m.saved_note_id ?? null,
        })),
      );
      setConversationId(cid);
      clearJobWatchers();
      setHistoryOpen(false);
      setError(null);
    } catch {
      setError("Couldn't open that chat.");
      setHistoryOpen(false);
    }
  };

  const lastMsg = messages[messages.length - 1];
  const awaitingFirstToken =
    sending && (!lastMsg || lastMsg.role !== "assistant" || !lastMsg.text);
  const hasMessages = messages.length > 0 || sending;

  const openNote = useCallback((id: string) => router.push(`/note/${id}`), [router]);

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => {
      if (item.role === "user") {
        return (
          <View className="mb-5 items-end">
            <View className="max-w-[85%] rounded-3xl rounded-br-md bg-accent px-4 py-2.5">
              <Text className="text-[15px] leading-relaxed text-ink">{item.text}</Text>
            </View>
          </View>
        );
      }
      // Assistant: borderless full-width text (ChatGPT-style), then the rich attachments.
      return (
        <View className="mb-5 gap-2.5">
          {item.text ? <AskMarkdown onNoteClick={openNote}>{item.text}</AskMarkdown> : null}
          {item.pending ? (
            <View className="flex-row items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3">
              <ActivityIndicator size="small" />
              <Text className="flex-1 text-sm text-ink-soft">
                Working on this. I'll save it as a note when it's ready. You can keep chatting.
              </Text>
            </View>
          ) : null}
          {item.failed ? (
            <Text className="text-sm text-destructive">
              That task couldn't be completed. Please try again.
            </Text>
          ) : null}
          {item.resultNoteId ? (
            <Pressable
              onPress={() => openNote(item.resultNoteId!)}
              className="flex-row items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 active:opacity-90"
            >
              <Text className="text-sm font-medium text-paper">Done. View the note</Text>
            </Pressable>
          ) : null}
          {item.saved_note_id ? (
            <Pressable
              onPress={() => openNote(item.saved_note_id!)}
              className="flex-row items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 active:opacity-90"
            >
              <Text className="text-sm font-medium text-paper">View saved note</Text>
            </Pressable>
          ) : null}
          {item.artifact ? (
            <ArtifactCard
              artifact={item.artifact}
              sourceIds={(item.citations ?? []).map((c) => c.id)}
              focalNoteId={noteId}
            />
          ) : null}
          {item.coverage ? (
            <Text className="text-[11px] text-ink-soft">{item.coverage}</Text>
          ) : null}
          {item.citations && item.citations.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
            >
              {item.citations.map((c) => (
                <CitationChip key={c.id} citation={c} />
              ))}
            </ScrollView>
          ) : null}
        </View>
      );
    },
    [openNote, noteId],
  );

  return (
    <View className="flex-1 bg-paper">
      <SafeAreaView className="flex-1" edges={["top"]}>
        {/* Header */}
        <View className="flex-row items-center gap-2 border-b border-border px-4 py-3">
          <View className="h-7 w-7 items-center justify-center rounded-lg bg-ink">
            <Sparkles size={16} className="text-paper" />
          </View>
          <Text className="flex-1 text-base font-semibold text-ink">Clip AI</Text>
          <Pressable
            onPress={() => setHistoryOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Chat history"
            className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
          >
            <Clock size={18} className="text-ink-soft" />
          </Pressable>
          {messages.length > 0 ? (
            <Pressable
              onPress={startNewChat}
              accessibilityRole="button"
              className="rounded-full border border-border bg-card px-3 py-1.5 active:opacity-80"
            >
              <Text className="text-xs text-ink-soft">New chat</Text>
            </Pressable>
          ) : null}
        </View>

        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
        >
          {/* Messages / idle state */}
          {!hasMessages ? (
            <View className="flex-1 items-center justify-center px-6 pb-16">
              <View className="h-12 w-12 items-center justify-center rounded-2xl bg-ink">
                <Sparkles size={22} className="text-paper" />
              </View>
              <Text className="mt-4 text-2xl font-semibold text-ink">What can I help with?</Text>
              <View className="mt-6 gap-2">
                {EXAMPLES.map((ex) => (
                  <Pressable
                    key={ex}
                    onPress={() => send(ex)}
                    accessibilityRole="button"
                    className="rounded-full border border-border bg-card px-4 py-2.5 active:opacity-80"
                  >
                    <Text className="text-center text-sm text-ink-soft">{ex}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            <FlashList
              ref={listRef}
              data={messages}
              extraData={{ sending, status, slowLabel, error, awaitingFirstToken }}
              keyExtractor={(_m, i) => String(i)}
              renderItem={renderMessage}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
              ListFooterComponent={
                <View>
                  {awaitingFirstToken ? (
                    <View className="flex-row items-center gap-2 py-1">
                      <ActivityIndicator size="small" />
                      <Text className="text-[13px] text-ink-soft">
                        {status ?? slowLabel ?? "Thinking…"}
                      </Text>
                    </View>
                  ) : null}
                  {error ? (
                    <View className="mt-2 flex-row items-start gap-2.5 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3">
                      <AlertCircle size={16} className="text-destructive" />
                      <Text className="flex-1 text-sm text-destructive">{error}</Text>
                    </View>
                  ) : null}
                </View>
              }
            />
          )}

          {/* Input bar, pinned to the bottom above the keyboard. */}
          <View className="border-t border-border bg-card px-3 pb-3 pt-2.5">
            <View className="flex-row items-end gap-2 rounded-2xl border border-border bg-card px-4 py-2">
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Ask, search, and create notes"
                placeholderTextColor={t["ink-soft"]}
                multiline
                className="max-h-[120px] flex-1 py-1.5 text-[15px] leading-relaxed text-ink"
                onSubmitEditing={() => send(input)}
              />
              <Pressable
                onPress={() => send(input)}
                disabled={!input.trim() || sending}
                accessibilityRole="button"
                accessibilityLabel="Send"
                className={`mb-0.5 h-8 w-8 items-center justify-center rounded-full bg-ink active:opacity-90 ${
                  !input.trim() || sending ? "opacity-40" : ""
                }`}
              >
                <ArrowUp size={16} className="text-paper" />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <HistorySheet
        visible={historyOpen}
        activeId={conversationId}
        onClose={() => setHistoryOpen(false)}
        onResume={resumeConversation}
        onNewChat={startNewChat}
      />
    </View>
  );
}
