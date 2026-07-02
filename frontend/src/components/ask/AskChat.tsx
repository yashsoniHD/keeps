import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { goToHit } from "@/lib/nav";
import {
  AlertCircle,
  ArrowUp,
  BookmarkPlus,
  Check,
  Clock,
  Loader2,
  MessageSquare,
  NotebookText,
  Search,
  Trash2,
  Sparkle,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useChatSession } from "@/contexts/ask-context";
import { useCategoryMeta } from "@/contexts/category-meta";
import { watchJob, watchNotes } from "@/lib/firestore";
import {
  askDeep,
  askStream,
  augmentNote,
  ApiError,
  deleteConversation,
  getConversation,
  listConversations,
  saveConsolidatedNote,
  type AskArtifact,
  type AskCitation,
  type ChatMessage,
  type ConversationSummary,
} from "@/lib/api";
import { GenericNote } from "@/components/note/templates/GenericNote";
import { renderMarkdown } from "@/lib/markdown";
import { noteAccent, noteIcon, noteLabel } from "@/lib/note-meta";
import type { Note } from "@/lib/types";
import { analytics } from "@/lib/analytics";

// Heuristic: route obviously-heavy, whole-corpus synthesis requests to the background
// (deep) worker instead of the bounded interactive stream. Conservative on purpose —
// only clearly-broad phrasing qualifies; everything else streams inline.
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

function CitationChip({
  citation,
  onNavigate,
}: {
  citation: AskCitation;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const accent = noteAccent(citation.content_type);
  const Icon = noteIcon(citation.content_type);
  // A citation is either a plain note or a mini-app item (app + ref_id) → route accordingly.
  return (
    <button
      type="button"
      onClick={() => {
        onNavigate?.();
        goToHit(navigate, citation.app, citation.ref_id || citation.id);
      }}
      className="flex max-w-[220px] shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${accent.chip}`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-ink">{citation.title}</span>
        <span className="block text-[11px] text-ink-soft">{noteLabel(citation.content_type)}</span>
      </span>
    </button>
  );
}

// ──────────────────────────── chat history helpers ────────────────────────────

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

type ConvoGroup = { label: string; items: ConversationSummary[] };

function groupConversations(convos: ConversationSummary[]): ConvoGroup[] {
  const now = Date.now();
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfWeek = startOfToday - 6 * 86_400_000;

  const groups: ConvoGroup[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Last 7 days", items: [] },
    { label: "Older", items: [] },
  ];

  for (const c of convos) {
    const d = toDate(c.updated_at);
    const t = d ? d.getTime() : now - 1; // missing date → treat as recent but not "today"
    if (t >= startOfToday) groups[0].items.push(c);
    else if (t >= startOfYesterday) groups[1].items.push(c);
    else if (t >= startOfWeek) groups[2].items.push(c);
    else groups[3].items.push(c);
  }

  return groups.filter((g) => g.items.length > 0);
}

// ──────────────────────────── artifact card ────────────────────────────

// A consolidated artifact (itinerary/meal plan/comparison/…) rendered with the same
// block components as a real note. Offers "Save as note" and — when the chat is open on a
// focal note — "Add to {note}" (additive merge into that note). Deliver-then-offer: the
// agent never writes; persistence is an explicit click here.
function ArtifactCard({
  artifact,
  sourceIds,
  focalNoteId,
  focalTitle,
  onNavigate,
}: {
  artifact: AskArtifact;
  sourceIds: string[];
  focalNoteId?: string | null;
  focalTitle?: string | null;
  onNavigate?: () => void;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "added" | "error">("idle");
  const [noteId, setNoteId] = useState<string | null>(null);

  const synthetic = useMemo(
    () =>
      ({
        id: "artifact",
        content_type: artifact.content_type,
        template: "composed",
        title: artifact.title,
        ai_summary: artifact.ai_summary,
        data: artifact.data,
        cover_image_url: null,
      }) as unknown as Note,
    [artifact],
  );

  const save = async () => {
    setState("saving");
    try {
      const { id } = await saveConsolidatedNote(artifact, sourceIds);
      setNoteId(id);
      setState("saved");
    } catch {
      setState("error");
    }
  };

  const addToNote = async () => {
    if (!focalNoteId) return;
    setState("saving");
    try {
      await augmentNote(focalNoteId, artifact, sourceIds);
      setNoteId(focalNoteId);
      setState("added");
    } catch {
      setState("error");
    }
  };

  const done = state === "saved" || state === "added";
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-serif text-2xl text-ink">{artifact.title}</h3>
      {artifact.ai_summary && <p className="mt-1 text-sm text-ink-soft">{artifact.ai_summary}</p>}
      <div className="mt-5">
        <GenericNote note={synthetic} />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {done && noteId ? (
          <Link
            to="/notes/$noteId"
            params={{ noteId }}
            onClick={onNavigate}
            className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
          >
            <Check className="h-4 w-4" />{" "}
            {state === "added" ? "Added — view note" : "Saved — view note"}
          </Link>
        ) : (
          <>
            <button
              type="button"
              onClick={save}
              disabled={state === "saving"}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent disabled:opacity-50"
            >
              {state === "saving" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BookmarkPlus className="h-4 w-4" />
              )}
              Save as note
            </button>
            {focalNoteId && (
              <button
                type="button"
                onClick={addToNote}
                disabled={state === "saving"}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent disabled:opacity-50"
              >
                <BookmarkPlus className="h-4 w-4" />
                Add to {focalTitle ? `“${focalTitle}”` : "this note"}
              </button>
            )}
          </>
        )}
        {state === "error" && (
          <span className="text-sm text-destructive">Couldn't save. Try again.</span>
        )}
      </div>
    </div>
  );
}

// The Ask-AI conversation, self-contained for use inside the docked overlay (components/
// ask/AskFab.tsx). When `noteId`/`noteTitle` are set, the chat is scoped to that focal note
// ("this note first, then all"). `seed` pre-fills + auto-sends once (feed search → Ask).
export function AskChat({
  noteId,
  noteTitle,
  seed,
  onSeedConsumed,
  onClose,
}: {
  noteId?: string | null;
  noteTitle?: string | null;
  seed?: string | null;
  onSeedConsumed?: () => void;
  onClose?: () => void;
}) {
  useCategoryMeta(); // reflect category icon/colour overrides on citation chips
  const { user } = useAuth();
  // The conversation (messages + server id + reference scope) is owned by AskProvider so it
  // survives this component unmounting when the panel closes — see ask-context.tsx. It clears
  // only on an explicit "New chat" (resetChat) or a page refresh.
  const {
    messages,
    setMessages,
    conversationId,
    setConversationId,
    selectedScope: selected,
    setSelectedScope: setSelected,
    resetChat,
  } = useChatSession();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null); // live agent activity ("Searching your notes…")
  const [slowLabel, setSlowLabel] = useState<string | null>(null); // rotating "Thinking…" while a reply is slow
  const [error, setError] = useState<string | null>(null);
  const watchedJobs = useRef<Set<string>>(new Set()); // deep-task job ids already subscribed
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerNotes, setPickerNotes] = useState<Note[]>([]);
  const [pickerQuery, setPickerQuery] = useState("");
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number } | null>(null);
  const swipeTouchStart = useRef<{ x: number; y: number } | null>(null);
  const SWIPE_REVEAL = 68;

  // Load the user's notes only when the picker is opened; live so new notes appear.
  useEffect(() => {
    if (!pickerOpen || !user) return;
    return watchNotes(user.uid, setPickerNotes, { max: 100 });
  }, [pickerOpen, user]);

  const toggleNote = (n: Note) =>
    setSelected((s) =>
      s.some((x) => x.id === n.id)
        ? s.filter((x) => x.id !== n.id)
        : s.length >= 20
          ? s
          : [...s, { id: n.id, title: n.title }],
    );

  const scopeLabel = selected.length
    ? `${selected.length} note${selected.length > 1 ? "s" : ""}`
    : noteId
      ? "This note"
      : "All notes";

  const filteredPickerNotes = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return q ? pickerNotes.filter((n) => (n.title || "").toLowerCase().includes(q)) : pickerNotes;
  }, [pickerNotes, pickerQuery]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seedSent = useRef<string | null>(null);

  useEffect(() => {
    // Desktop only — don't pop the software keyboard open the moment the chat
    // opens on mobile (the user taps the input when they're ready to type).
    if (window.matchMedia("(min-width: 640px)").matches) {
      inputRef.current?.focus();
    }
  }, []);

  // Grow the textarea with its content up to ~5 lines, then scroll internally.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // Watch each pending deep-task job; flip the message to a result link (or failure) on
  // completion. The chat is stateless, so this is the only place the background job surfaces.
  useEffect(() => {
    const unsubs = messages
      .filter((m) => m.pending && m.jobId && !watchedJobs.current.has(m.jobId))
      .map((m) => {
        const jid = m.jobId!;
        watchedJobs.current.add(jid);
        return watchJob(jid, (job) => {
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
          }
        });
      });
    return () => unsubs.forEach((u) => u());
  }, [messages]);

  // Rotating "Thinking…" copy once a streamed reply is slow to start (no token, no tool
  // status yet). Kicks in after a beat so quick replies never flash it.
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

  // replaceLast drops the trailing (failed) user message before resending, so a retry
  // doesn't send the question twice — once in `history` and once as `question`.
  const send = async (raw: string, replaceLast = false) => {
    const question = raw.trim();
    if (!question || sending) return;
    analytics.askSubmitted();
    analytics.clipAiUsed(); // funnel: first time the user engages Clip AI (once per browser)
    const base = replaceLast ? messages.slice(0, -1) : messages;
    const history = base.map(({ role, text }) => ({ role, text })).slice(-10);

    // Heavy whole-corpus jobs run in the background (Cloud Tasks worker) and write a note
    // we surface when it completes — the chat stays usable meanwhile.
    if (looksHeavy(question)) {
      setMessages([
        ...base,
        { role: "user", text: question },
        { role: "assistant", text: "", pending: true },
      ]);
      setInput("");
      setError(null);
      try {
        const { job_id } = await askDeep(
          question,
          noteId ?? undefined,
          selected.map((s) => s.id),
        );
        setMessages((m) => {
          const last = m[m.length - 1];
          if (!last || last.role !== "assistant") return m;
          return [...m.slice(0, -1), { ...last, jobId: job_id }];
        });
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Couldn't start the task. Please try again.");
        setMessages((m) => (m[m.length - 1]?.pending ? m.slice(0, -1) : m));
      }
      return;
    }

    // Push the user turn + an empty assistant turn we mutate in place as deltas stream in.
    setMessages([...base, { role: "user", text: question }, { role: "assistant", text: "" }]);
    setInput("");
    setError(null);
    setStatus(null);
    setSending(true);

    // Mutate only the trailing assistant message as events arrive.
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

    try {
      await askStream(
        question,
        history,
        noteId ?? undefined,
        selected.map((s) => s.id),
        conversationId,
        {
          onConversation: (id) => setConversationId(id),
          onStatus: (s) => setStatus(s),
          onDelta: (t) => {
            setStatus(null); // first token clears the activity line
            appendDelta(t);
          },
          onCitations: (citations) => patchLast({ citations }),
          onArtifact: (artifact) => patchLast({ artifact }),
          onCoverage: (coverage) => patchLast({ coverage }),
          onSavedNote: (note_id) => patchLast({ saved_note_id: note_id }),
          onError: (message) => setError(message),
        },
      );
    } catch (e) {
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
    }
  };

  const startNewChat = () => {
    resetChat(); // clears messages + conversation id + reference scope (owned by the context)
    watchedJobs.current.clear(); // drop deep-task subscriptions from the old conversation
    setError(null);
    setHistoryOpen(false);
    inputRef.current?.focus();
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      setConversations(await listConversations());
    } catch {
      /* a failed history load just shows an empty list */
    } finally {
      setHistoryLoading(false);
    }
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
      setHistoryOpen(false);
      setError(null);
    } catch {
      setError("Couldn't open that chat.");
    }
  };

  const removeConversation = async (cid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteConversation(cid);
      setConversations((cs) => cs.filter((c) => c.id !== cid));
      if (cid === conversationId) startNewChat();
    } catch {
      /* leave the row; the user can retry */
    }
  };

  // A seed (from the feed search bar) is sent once when the panel opens with it.
  useEffect(() => {
    if (seed && seedSent.current !== seed) {
      seedSent.current = seed;
      send(seed);
      onSeedConsumed?.();
    } else if (!seed) {
      // Reset the guard once consumed/cleared so the SAME query can re-seed a later open.
      seedSent.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const hasMessages = messages.length > 0 || sending;
  // While streaming, the trailing assistant message fills in live; show the activity/typing
  // indicator only until its first token lands.
  const lastMsg = messages[messages.length - 1];
  const awaitingFirstToken = sending && (!lastMsg || lastMsg.role !== "assistant" || !lastMsg.text);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Chat history drawer — a self-contained overlay so the message view stays untouched. */}
      {historyOpen && (
        <div className="absolute inset-0 z-20 flex flex-col bg-card">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
            <p className="flex-1 text-base font-semibold text-ink">Chat history</p>
            <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              aria-label="Close history"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-soft hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {historyLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-ink-soft" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center py-14 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-ink-soft">
                  <MessageSquare className="h-5 w-5" />
                </span>
                <p className="mt-3 text-sm font-medium text-ink">No saved chats yet</p>
                <p className="mt-1 text-xs text-ink-soft">Your conversations will appear here.</p>
              </div>
            ) : (
              <div className="p-2">
                {groupConversations(conversations).map((group) => (
                  <div key={group.label} className="mb-1">
                    <p className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-ink-soft">
                      {group.label}
                    </p>
                    {group.items.map((c) => {
                      const tx = drag?.id === c.id ? drag.x : swipedId === c.id ? -SWIPE_REVEAL : 0;
                      const isOpen = swipedId === c.id && drag?.id !== c.id;
                      return (
                        <div key={c.id} className="relative overflow-hidden rounded-xl">
                          {/* Delete zone revealed behind the sliding row */}
                          <button
                            type="button"
                            aria-label="Delete chat"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeConversation(c.id, e);
                              setSwipedId(null);
                            }}
                            className="absolute inset-y-0 right-0 flex items-center justify-center bg-destructive text-white"
                            style={{ width: SWIPE_REVEAL }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>

                          {/* Sliding row */}
                          <div
                            role="button"
                            tabIndex={0}
                            style={{
                              transform: `translateX(${tx}px)`,
                              transition: drag?.id === c.id ? "none" : "transform 0.2s ease-out",
                              touchAction: "pan-y",
                            }}
                            onClick={() => {
                              if (isOpen) {
                                setSwipedId(null);
                                return;
                              }
                              resumeConversation(c.id);
                            }}
                            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && resumeConversation(c.id)}
                            onTouchStart={(e) => {
                              if (swipedId && swipedId !== c.id) setSwipedId(null);
                              swipeTouchStart.current = {
                                x: e.touches[0].clientX,
                                y: e.touches[0].clientY,
                              };
                              setDrag({ id: c.id, x: swipedId === c.id ? -SWIPE_REVEAL : 0 });
                            }}
                            onTouchMove={(e) => {
                              if (!swipeTouchStart.current || drag?.id !== c.id) return;
                              const dx = e.touches[0].clientX - swipeTouchStart.current.x;
                              const dy = e.touches[0].clientY - swipeTouchStart.current.y;
                              if (Math.abs(dy) > Math.abs(dx) + 4) {
                                setDrag(null);
                                return;
                              }
                              const base = swipedId === c.id ? -SWIPE_REVEAL : 0;
                              setDrag({
                                id: c.id,
                                x: Math.max(-SWIPE_REVEAL, Math.min(0, base + dx)),
                              });
                            }}
                            onTouchEnd={() => {
                              if (!drag || drag.id !== c.id) return;
                              setSwipedId(drag.x < -SWIPE_REVEAL / 2 ? c.id : null);
                              setDrag(null);
                              swipeTouchStart.current = null;
                            }}
                            className={`group flex w-full cursor-pointer items-center gap-2 rounded-xl bg-background px-3 py-2.5 text-left transition-colors hover:bg-accent ${
                              c.id === conversationId ? "bg-accent" : ""
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-ink">{c.title}</span>
                              {c.updated_at && (
                                <span className="block text-[11px] text-ink-soft">
                                  {formatConvoTime(c.updated_at)}
                                </span>
                              )}
                            </span>
                            {/* Desktop hover-only delete */}
                            <button
                              type="button"
                              aria-label="Delete chat"
                              onClick={(e) => removeConversation(c.id, e)}
                              className="hidden shrink-0 text-ink-soft transition-colors hover:text-destructive sm:block sm:opacity-0 sm:group-hover:opacity-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Mobile-only grab handle — the affordance for swipe-to-dismiss (the sheet is full-screen). */}
      <div data-drag-zone className="flex shrink-0 justify-center pt-2.5 pb-1 sm:hidden">
        <span className="h-1.5 w-10 rounded-full bg-border" />
      </div>
      {/* Header: title / focal-note context + new-chat + close. data-drag-zone lets a downward
          drag starting here dismiss the mobile sheet even when the message list is scrolled. */}
      <div
        data-drag-zone
        className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink text-paper">
          <Sparkle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold leading-tight text-ink">Clip AI</p>
          {noteTitle && (
            <p className="truncate text-[11px] text-ink-soft">Asking about: {noteTitle}</p>
          )}
        </div>
        <button
          type="button"
          onClick={historyOpen ? () => setHistoryOpen(false) : openHistory}
          aria-label="Chat history"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:text-ink"
        >
          <Clock className="h-4 w-4" />
        </button>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={startNewChat}
            className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-ink-soft transition-colors hover:text-ink"
          >
            New chat
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Messages / idle state. data-scroll lets the mobile sheet's swipe-to-dismiss know when
          the list is at the top (so a downward drag closes instead of scrolling). */}
      <div data-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {!hasMessages ? (
          <div className="flex h-full flex-col items-center justify-center px-4 pb-10 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink text-paper">
              <Sparkle className="h-5 w-5" />
            </span>
            <h2 className="mt-4 font-serif text-2xl text-ink">
              {noteTitle ? "Ask about this note" : "What can I help with?"}
            </h2>
            {!noteTitle && (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => send(ex)}
                    className="rounded-full border border-border bg-card px-3.5 py-2 text-sm text-ink-soft transition-colors hover:bg-accent hover:text-ink"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div
                  key={i}
                  className="flex justify-end duration-300 animate-in fade-in-0 slide-in-from-bottom-1"
                >
                  <div className="max-w-[85%] rounded-3xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] leading-relaxed text-ink">
                    {m.text}
                  </div>
                </div>
              ) : (
                // ChatGPT-style: assistant replies are borderless, full-width text — no bubble, no avatar.
                <div
                  key={i}
                  className="space-y-2.5 text-[15px] leading-relaxed text-ink duration-300 animate-in fade-in-0 slide-in-from-bottom-1"
                >
                  {m.text && renderMarkdown(m.text)}
                  {/* Deep async task: working → result link / failure. */}
                  {m.pending && (
                    <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-ink-soft">
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-soft" />
                      <span>
                        Working on this — I'll save it as a note when it's ready. You can keep
                        chatting.
                      </span>
                    </div>
                  )}
                  {m.failed && (
                    <p className="text-sm text-destructive">
                      That task couldn't be completed. Please try again.
                    </p>
                  )}
                  {m.resultNoteId && (
                    <Link
                      to="/notes/$noteId"
                      params={{ noteId: m.resultNoteId }}
                      onClick={onClose}
                      className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
                    >
                      <Check className="h-4 w-4" /> Done — view the note
                    </Link>
                  )}
                  {m.saved_note_id && (
                    <Link
                      to="/notes/$noteId"
                      params={{ noteId: m.saved_note_id }}
                      onClick={onClose}
                      className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
                    >
                      <Check className="h-4 w-4" /> View saved note
                    </Link>
                  )}
                  {m.artifact && (
                    <ArtifactCard
                      artifact={m.artifact}
                      sourceIds={(m.citations ?? []).map((c) => c.id)}
                      focalNoteId={noteId}
                      focalTitle={noteTitle}
                      onNavigate={onClose}
                    />
                  )}
                  {m.coverage && <p className="text-[11px] text-ink-soft">{m.coverage}</p>}
                  {m.citations && m.citations.length > 0 && (
                    <div className="-mx-0.5 flex gap-2 overflow-x-auto px-0.5 pb-1">
                      {m.citations.map((c) => (
                        <CitationChip key={c.id} citation={c} onNavigate={onClose} />
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
            {awaitingFirstToken &&
              (status || slowLabel ? (
                // Live agent activity ("Searching your notes…") or, if it's just slow,
                // rotating "Thinking…" copy so the wait never feels frozen.
                <div
                  className="flex items-center gap-2 py-1 text-[13px] text-ink-soft duration-300 animate-in fade-in-0"
                  aria-live="polite"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{status ?? slowLabel}</span>
                </div>
              ) : (
                // Compact three-dot typing indicator, left-aligned like the assistant text above it.
                <div
                  className="flex items-center gap-1 py-1 duration-300 animate-in fade-in-0"
                  aria-label="Thinking"
                >
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft/70 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft/70 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft/70" />
                </div>
              ))}
            {error && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <p>{error}</p>
                  {lastUserMessage && (
                    <button
                      type="button"
                      onClick={() => send(lastUserMessage.text, true)}
                      className="mt-1.5 font-medium underline underline-offset-2"
                    >
                      Try again
                    </button>
                  )}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Reference-scope picker panel (opens above the input). */}
      {pickerOpen && (
        <div className="shrink-0 border-t border-border bg-card px-3 pt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-ink">Reference specific notes</p>
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-paper"
            >
              Done
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-ink-soft" />
            <input
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="Search your notes"
              className="w-full bg-transparent text-sm outline-none placeholder:text-ink-soft"
            />
          </label>
          <div className="mt-2 max-h-48 space-y-1 overflow-y-auto overscroll-contain pb-2">
            {filteredPickerNotes.map((n) => {
              const on = selected.some((x) => x.id === n.id);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => toggleNote(n)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      on ? "border-ink bg-ink text-paper" : "border-border"
                    }`}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate text-sm text-ink">{n.title}</span>
                </button>
              );
            })}
            {filteredPickerNotes.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-ink-soft">No notes found.</p>
            )}
          </div>
        </div>
      )}

      {/* Input bar. */}
      <div className="shrink-0 border-t border-border bg-card/95 px-3 pt-2.5 pb-[max(1.25rem,env(safe-area-inset-bottom))] backdrop-blur">
        {/* Reference-scope pill + selected chips. */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-ink-soft transition-colors hover:text-ink"
          >
            <NotebookText className="h-3.5 w-3.5" />
            {scopeLabel}
          </button>
          {selected.map((s) => (
            <span
              key={s.id}
              className="inline-flex max-w-[160px] items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs text-ink"
            >
              <span className="truncate">{s.title}</span>
              <button
                type="button"
                aria-label={`Remove ${s.title}`}
                onClick={() => setSelected((cur) => cur.filter((x) => x.id !== s.id))}
                className="shrink-0 text-ink-soft hover:text-ink"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => setSelected([])}
              className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
        <form
          className="flex items-end gap-2 rounded-2xl border border-border bg-card px-4 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter inserts a newline (standard chat behaviour).
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask, search, and create notes"
            className="max-h-[120px] flex-1 resize-none bg-transparent py-1 text-sm leading-relaxed outline-none placeholder:text-ink-soft"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            aria-label="Send"
            className="mb-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-transform active:scale-95 disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
