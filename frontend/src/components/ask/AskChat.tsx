import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  BookmarkPlus,
  CalendarDays,
  Check,
  GitCompare,
  Loader2,
  Map,
  Send,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCategoryMeta } from "@/contexts/category-meta";
import { ask, ApiError, saveConsolidatedNote, type AskArtifact, type AskCitation } from "@/lib/api";
import { GenericNote } from "@/components/note/templates/GenericNote";
import { renderMarkdown } from "@/lib/markdown";
import { noteAccent, noteIcon, noteLabel } from "@/lib/note-meta";
import type { Note } from "@/lib/types";

interface Message {
  role: "user" | "assistant";
  text: string;
  citations?: AskCitation[];
  coverage?: string | null;
  artifact?: AskArtifact | null;
}

const EXAMPLES = [
  "Summarize what I saved today",
  "What recipes have I saved?",
  "Build an itinerary from my saved trips",
  "Compare the products I'm considering",
];

const CAPABILITIES: { icon: LucideIcon; label: string }[] = [
  { icon: Sparkles, label: "Summarize" },
  { icon: CalendarDays, label: "Find by date" },
  { icon: Map, label: "Build itineraries" },
  { icon: GitCompare, label: "Compare" },
];

function CitationChip({ citation, onNavigate }: { citation: AskCitation; onNavigate?: () => void }) {
  const accent = noteAccent(citation.content_type);
  const Icon = noteIcon(citation.content_type);
  return (
    <Link
      to="/notes/$noteId"
      params={{ noteId: citation.id }}
      onClick={onNavigate}
      className="flex max-w-[220px] shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 transition-colors hover:bg-accent"
    >
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${accent.chip}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-ink">{citation.title}</span>
        <span className="block text-[11px] text-ink-soft">{noteLabel(citation.content_type)}</span>
      </span>
    </Link>
  );
}

// A consolidated artifact (itinerary/meal plan/comparison/…) rendered with the same
// block components as a real note, plus a one-tap "Save as note".
function ArtifactCard({
  artifact,
  sourceIds,
  onNavigate,
}: {
  artifact: AskArtifact;
  sourceIds: string[];
  onNavigate?: () => void;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
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

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-serif text-2xl text-ink">{artifact.title}</h3>
      {artifact.ai_summary && <p className="mt-1 text-sm text-ink-soft">{artifact.ai_summary}</p>}
      <div className="mt-5">
        <GenericNote note={synthetic} />
      </div>
      <div className="mt-5 flex items-center gap-3">
        {state === "saved" && noteId ? (
          <Link
            to="/notes/$noteId"
            params={{ noteId }}
            onClick={onNavigate}
            className="inline-flex items-center gap-2 rounded-full bg-summary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Check className="h-4 w-4" /> Saved — view note
          </Link>
        ) : (
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
        )}
        {state === "error" && <span className="text-sm text-red-600">Couldn't save. Try again.</span>}
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seedSent = useRef<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // replaceLast drops the trailing (failed) user message before resending, so a retry
  // doesn't send the question twice — once in `history` and once as `question`.
  const send = async (raw: string, replaceLast = false) => {
    const question = raw.trim();
    if (!question || sending) return;
    const base = replaceLast ? messages.slice(0, -1) : messages;
    const history = base.map(({ role, text }) => ({ role, text })).slice(-10);
    setMessages([...base, { role: "user", text: question }]);
    setInput("");
    setError(null);
    setSending(true);
    try {
      const res = await ask(question, history, noteId ?? undefined);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: res.answer,
          citations: res.citations,
          coverage: res.coverage,
          artifact: res.artifact,
        },
      ]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't get an answer. Please try again.");
    } finally {
      setSending(false);
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: title / focal-note context + new-chat + close. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-summary-soft text-summary">
          <WandSparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-lg leading-tight text-ink">Ask AI</p>
          {noteTitle && (
            <p className="truncate text-[11px] text-ink-soft">Asking about: {noteTitle}</p>
          )}
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setError(null);
              inputRef.current?.focus();
            }}
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

      {/* Messages / idle state. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!hasMessages ? (
          <div className="flex flex-col items-center pt-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-summary-soft text-summary">
              <WandSparkles className="h-5 w-5" />
            </span>
            <h2 className="mt-3 font-serif text-xl text-ink">
              {noteTitle ? "Ask about this note" : "Ask anything about your notes"}
            </h2>
            <p className="mt-1.5 max-w-xs text-sm text-ink-soft">
              {noteTitle
                ? "Answers lead with this note, then draw on the rest of what you've saved."
                : "Answers come only from what you've saved, and every reply links back to its notes."}
            </p>
            {!noteTitle && (
              <>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {CAPABILITIES.map(({ icon: Icon, label }) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-ink-soft"
                    >
                      <Icon className="h-3.5 w-3.5 text-summary" />
                      {label}
                    </span>
                  ))}
                </div>
                <div className="mt-5 grid w-full gap-2">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => send(ex)}
                      className="rounded-2xl border border-border bg-card p-3.5 text-left text-sm text-ink transition-colors hover:bg-accent"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div
                  key={i}
                  className="flex justify-end duration-300 animate-in fade-in-0 slide-in-from-bottom-1"
                >
                  <div className="max-w-[85%] rounded-3xl rounded-br-md bg-ink px-4 py-2.5 text-sm leading-relaxed text-paper">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div
                  key={i}
                  className="flex gap-2.5 duration-300 animate-in fade-in-0 slide-in-from-bottom-1"
                >
                  {/* Assistant glyph, like Claude/ChatGPT — borderless text flows beside it. */}
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-summary-soft text-summary">
                    <WandSparkles className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-2.5">
                    {m.text && renderMarkdown(m.text)}
                    {m.artifact && (
                      <ArtifactCard
                        artifact={m.artifact}
                        sourceIds={(m.citations ?? []).map((c) => c.id)}
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
                </div>
              ),
            )}
            {sending && (
              <div className="flex gap-2.5 duration-300 animate-in fade-in-0">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-summary-soft text-summary">
                  <WandSparkles className="h-3.5 w-3.5" />
                </span>
                {/* Compact three-dot typing indicator (replaces the oversized "Thinking…" card). */}
                <div className="flex items-center gap-1 py-2.5" aria-label="Thinking">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft/70 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft/70 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft/70" />
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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

      {/* Input bar. */}
      <div className="shrink-0 border-t border-border bg-background/90 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <label className="flex flex-1 items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5">
            <WandSparkles className="h-4 w-4 shrink-0 text-ink-soft" />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={noteTitle ? "Ask about this note" : "Ask about your saved notes"}
              className="w-full bg-transparent text-base outline-none placeholder:text-ink-soft md:text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={!input.trim() || sending}
            aria-label="Send"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-transform active:scale-95 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
