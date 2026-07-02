import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Search as SearchIcon, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { searchNotes, type SearchResult } from "@/lib/api";
import { goToHit } from "@/lib/nav";
import { TOOLS, toolForHit, type ToolMeta } from "@/lib/collections-meta";
import { FOCUS_RING } from "@/lib/ui";
import { AppShell } from "@/components/AppShell";

// Global search across EVERYTHING saved — notes AND mini-app items (movies, recipes, places,
// products, trips) — via the unified search_index (GET /api/search). Results are grouped by the
// tool they belong to and each routes to its own detail. This is the app's real search entry
// (the old header icon merely linked to the notes feed, whose inline search hid mini-app items).
export const Route = createFileRoute("/search")({ component: SearchScreen });

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

type Status = "idle" | "searching" | "done" | "error";

function ResultRow({ hit, onOpen }: { hit: SearchResult; onOpen: () => void }) {
  const tool = toolForHit(hit.app);
  const Icon = tool.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`press flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition-shadow hover:shadow-md ${FOCUS_RING}`}
    >
      <span className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-muted">
        {hit.cover_image_url ? (
          <img src={hit.cover_image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className={`flex h-full w-full items-center justify-center ${tool.soft}`}>
            <Icon className="h-5 w-5" />
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

function Group({
  tool,
  hits,
  onOpen,
}: {
  tool: ToolMeta;
  hits: SearchResult[];
  onOpen: (h: SearchResult) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-ink-soft">
        <tool.icon className={`h-3.5 w-3.5 ${tool.text}`} />
        {tool.label}
        <span className="text-ink-soft/60">· {hits.length}</span>
      </h2>
      <div className="space-y-2">
        {hits.map((h) => (
          <ResultRow key={`${h.app ?? "note"}-${h.ref_id ?? h.id}`} hit={h} onOpen={() => onOpen(h)} />
        ))}
      </div>
    </section>
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

  // Group hits by tool, in the canonical tool order, dropping empty groups.
  const groups = useMemo(() => {
    return TOOLS.map((tool) => ({
      tool,
      hits: results.filter((r) => toolForHit(r.app).key === tool.key),
    })).filter((g) => g.hits.length > 0);
  }, [results]);

  const open = (h: SearchResult) => goToHit(navigate, h.app, h.ref_id ?? h.id);

  return (
    <AppShell>
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 md:px-8">
          <Link
            to="/"
            aria-label="Back to Library"
            className={`inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`}
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
              Search across everything — your notes, movies, recipes, places, products, and trips.
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
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-24 text-center text-ink-soft">
            <p className="text-sm">
              Nothing matched “<span className="text-ink">{trimmed}</span>”.
            </p>
            <p className="text-xs">Try a different word, a title, or a place name.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map((g) => (
              <Group key={g.tool.key} tool={g.tool} hits={g.hits} onOpen={open} />
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
