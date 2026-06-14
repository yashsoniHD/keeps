import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  BookmarkPlus,
  CalendarDays,
  Check,
  ChevronLeft,
  GitCompare,
  Loader2,
  Map,
  Send,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useCategoryMeta } from "@/contexts/category-meta";
import { ask, ApiError, saveConsolidatedNote, type AskArtifact, type AskCitation } from "@/lib/api";
import { GenericNote } from "@/components/note/templates/GenericNote";
import { renderMarkdown } from "@/lib/markdown";
import { noteAccent, noteIcon, noteLabel } from "@/lib/note-meta";
import type { Note } from "@/lib/types";
import { useKeyboardPin } from "@/lib/use-keyboard-inset";

interface AskSearch {
  q?: string;
  send?: boolean;
}

export const Route = createFileRoute("/ask")({
  validateSearch: (search: Record<string, unknown>): AskSearch => ({
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    send: search.send === true || search.send === "true" || search.send === 1 ? true : undefined,
  }),
  component: AskPage,
});

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

// What Ask AI can do, mirroring the planner's real outputs (backend AskPlan). Static —
// they teach at a glance; the starter prompts below are the clickable actions.
const CAPABILITIES: { icon: LucideIcon; label: string }[] = [
  { icon: Sparkles, label: "Summarize" },
  { icon: CalendarDays, label: "Find by date" },
  { icon: Map, label: "Build itineraries" },
  { icon: GitCompare, label: "Compare" },
];

function CitationChip({ citation }: { citation: AskCitation }) {
  const accent = noteAccent(citation.content_type);
  const Icon = noteIcon(citation.content_type);
  return (
    <Link
      to="/notes/$noteId"
      params={{ noteId: citation.id }}
      className="flex max-w-[220px] shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 transition-colors hover:bg-accent"
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
    </Link>
  );
}

// A consolidated artifact (itinerary/meal plan/comparison/…) rendered with the same
// block components as a real note, plus a one-tap "Save as note".
function ArtifactCard({ artifact, sourceIds }: { artifact: AskArtifact; sourceIds: string[] }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [noteId, setNoteId] = useState<string | null>(null);

  // GenericNote only reads `data` + `content_type`, so a partial note is enough to render.
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
        {state === "error" && (
          <span className="text-sm text-red-600">Couldn't save. Try again.</span>
        )}
      </div>
    </div>
  );
}

function AskPage() {
  const { user, loading } = useAuth();
  useCategoryMeta(); // reflect category icon/colour overrides on citation chips
  const navigate = useNavigate();
  const { q, send: autoSend } = Route.useSearch();
  const [messages, setMessages] = useState<Message[]>([]);
  // With send=true the query is submitted on arrival, so the input starts empty.
  const [input, setInput] = useState(q && !autoSend ? q : "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);
  const inputBarRef = useKeyboardPin<HTMLDivElement>();

  useEffect(() => {
    if (!loading && !user) {
      navigate({
        to: "/login",
        search: { redirect: `${window.location.pathname}${window.location.search}` },
      });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || sending) return;
    const history = messages.map(({ role, text }) => ({ role, text })).slice(-10);
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setError(null);
    setSending(true);
    try {
      const res = await ask(question, history);
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

  // AI-search button on the feed sends the query straight through (explicit intent);
  // fires once, after auth resolves so the login round-trip doesn't drop it.
  useEffect(() => {
    if (user && q && autoSend && !autoSent.current) {
      autoSent.current = true;
      send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, q, autoSend]);

  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");

  if (loading || !user) return null;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
          <Link
            to="/"
            aria-label="Back to your notes"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="flex-1 font-serif text-xl text-ink">Ask your notes</span>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setError(null);
                inputRef.current?.focus();
              }}
              className="shrink-0 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
            >
              New chat
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-5 pb-28">
        {messages.length === 0 && !sending ? (
          <div className="flex flex-col items-center pt-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-summary-soft text-summary">
              <WandSparkles className="h-6 w-6" />
            </span>
            <h2 className="mt-4 font-serif text-2xl text-ink">Ask anything about your notes</h2>
            <p className="mt-1.5 max-w-sm text-sm text-ink-soft">
              Answers come only from what you've saved, and every reply links back to the notes it
              used.
            </p>

            <div className="mt-5 flex flex-wrap justify-center gap-2">
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

            <div className="mt-6 grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => send(ex)}
                  className="rounded-2xl border border-border bg-card p-4 text-left text-sm text-ink transition-colors hover:bg-accent"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl bg-ink px-4 py-2.5 text-sm text-paper">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="space-y-2">
                  {m.text && (
                    <div className="max-w-[95%] rounded-2xl border border-border bg-card px-4 py-3">
                      {renderMarkdown(m.text)}
                    </div>
                  )}
                  {m.artifact && (
                    <ArtifactCard
                      artifact={m.artifact}
                      sourceIds={(m.citations ?? []).map((c) => c.id)}
                    />
                  )}
                  {m.coverage && (
                    <p className="px-1 text-[11px] text-ink-soft">{m.coverage}</p>
                  )}
                  {m.citations && m.citations.length > 0 && (
                    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                      {m.citations.map((c) => (
                        <CitationChip key={c.id} citation={c} />
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
            {sending && (
              <div className="flex max-w-[95%] items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-ink-soft">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking…
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
                      onClick={() => {
                        setMessages((m) => m.slice(0, -1));
                        send(lastUserMessage.text);
                      }}
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
      </main>

      <div
        ref={inputBarRef}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/90 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"
      >
        <form
          className="mx-auto flex w-full max-w-2xl items-center gap-2"
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
              placeholder="Ask about your saved notes"
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
