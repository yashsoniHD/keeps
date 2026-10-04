import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Search as SearchIcon, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { searchNotes, type SearchResult } from "@/lib/api";
import { goToNote } from "@/lib/nav";
import { noteAccent, noteIcon } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import { AppShell } from "@/components/AppShell";

// Global search across everything saved (GET /api/search, keyword + vector over notes).
// One flat, relevance-ranked list of notes; each row opens /notes/$id.
export const Route = createFileRoute("/search")({ component: SearchScreen });

const MIN_CHARS = 3; // the backend rejects shorter queries
const DEBOUNCE_MS = 300;

type Status = "idle" | "searching" | "done" | "error";

function ResultRow({ hit, onOpen }: { hit: SearchResult; onOpen: () => void }) {
  const accent = noteAccent(hit.content_type);
  const Icon = noteIcon(hit.content_type);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`press flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition-shadow hover:shadow-md ${FOCUS_RING}`}
    >
      <span className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-muted">
        {hit.cover_image_url ? (
          <img
            src={hit.cover_image_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className={`flex h-full w-full items-center justify-center ${accent.soft}`}>
            <Icon className={`h-5 w-5 ${accent.text}`} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{hit.title || "Untitled"}</span>
        {hit.ai_summary && (
          <span className="mt-0.5 block truncate text-sm text-ink-soft">{hit.ai_summary}</span>
        )}
      </span>
    </button>
  );
}

function SearchScreen() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed.length < MIN_CHARS) {
      setResults([]);
      setStatus("idle");
      return;
    }
    setStatus("searching");
    const handle = setTimeout(async () => {
      try {
        const res = await searchNotes(trimmed);
        setResults(res);
        setStatus("done");
      } catch {
        setResults([]);
        setStatus("error");
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [trimmed]);

  const open = (h: SearchResult) => goToNote(navigate, h.ref_id ?? h.id);

  return (
    <AppShell>
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 md:px-8">
          <Link
            to="/"
            aria-label="Back home"
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search everything you've saved"
              aria-label="Search"
              className={`h-11 w-full rounded-full border border-border bg-card pl-11 pr-10 text-base outline-none ${FOCUS_RING}`}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                aria-label="Clear"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        {trimmed.length < MIN_CHARS ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center text-ink-soft">
            <SearchIcon className="h-8 w-8" />
            <p className="max-w-xs text-sm">
              Search everything you've saved: by topic, title, or place name.
            </p>
          </div>
        ) : status === "searching" ? (
          <div className="flex items-center justify-center gap-2 py-24 text-ink-soft">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Searching…</span>
          </div>
        ) : status === "error" ? (
          <div className="rounded-2xl bg-destructive/10 p-4 text-center text-sm text-destructive">
            Search didn't work just now. Try again.
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-24 text-center text-ink-soft">
            <p className="text-sm">
              Nothing matched “<span className="text-ink">{trimmed}</span>”.
            </p>
            <p className="text-xs">Try a different word, a title, or a place name.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {results.map((h) => (
              <ResultRow key={h.ref_id ?? h.id} hit={h} onOpen={() => open(h)} />
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
