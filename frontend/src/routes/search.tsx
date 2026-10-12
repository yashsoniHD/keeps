import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { useAuth } from "@/contexts/auth-context";
import { ApiError, searchNotes, type SearchResult } from "@/lib/api";
import { getNote } from "@/lib/firestore";
import { goToNote } from "@/lib/nav";
import { noteLabel, sourceLabel } from "@/lib/note-meta";
import type { Note } from "@/lib/types";
import { EmptyState, Icon, NoteRow, SearchInput } from "@/keeps/ui";
import { toView } from "@/keeps/toView";
import type { NoteView } from "@/keeps/view";
import { NoteActions } from "@/keeps/NoteActions";

// Global search across everything saved (GET /api/search, keyword + vector over notes).
// One flat, relevance-ranked list of notes; each row opens /notes/$id.
export const Route = createFileRoute("/search")({ component: SearchScreen });

const MIN_CHARS = 3; // the backend rejects shorter queries
const DEBOUNCE_MS = 300;

type Status = "idle" | "searching" | "done" | "error";

// Search hits are not full notes, so build a display-only view (no blocks).
function hitView(h: SearchResult): NoteView {
  return {
    id: h.ref_id ?? h.id,
    title: h.title || "Untitled",
    summary: h.ai_summary ?? "",
    categorySlug: h.content_type ?? "",
    category: noteLabel(h.content_type ?? ""),
    platform: sourceLabel(h.source_domain ?? ""),
    image: h.cover_image_url ?? undefined,
    url: "",
    age: sourceLabel(h.source_domain ?? ""),
    thin: false,
    facts: [],
    blocks: [],
    tags: [],
    createdAt: 0,
    note: {} as Note,
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Excerpt around the first match, with query terms wrapped in <mark> (React text, no HTML).
function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query
    .split(/\s+/)
    .filter((x) => x.length >= MIN_CHARS)
    .map(escapeRe);
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(`(${terms.join("|")})`, "gi");
  const at = text.search(pattern);
  const start = Math.max(0, at - 60);
  const shown = (start > 0 ? "…" : "") + text.slice(start);
  return <>{shown.split(pattern).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}

function SearchScreen() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const inputWasFocused = useRef(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState("");
  const [settled, setSettled] = useState(""); // the query `results`/`status` belong to
  const [actionView, setActionView] = useState<NoteView | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  // Cmd/Ctrl+K while already here: refocus the field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")
        document.querySelector<HTMLInputElement>(".search-field input")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed.length < MIN_CHARS) {
      setResults([]);
      setStatus("idle");
      return;
    }
    setStatus("searching");
    let cancelled = false; // a late response for an older query must not overwrite the newer one
    const handle = setTimeout(async () => {
      try {
        const res = await searchNotes(trimmed);
        if (cancelled) return;
        setResults(res);
        setStatus("done");
        setSettled(trimmed);
      } catch (e) {
        if (cancelled) return;
        // 4xx (daily cap, rate limit) carries an actionable message; offline gets its own hint.
        setErrorText(
          !navigator.onLine
            ? "You're offline. Search needs a connection."
            : e instanceof ApiError && e.status >= 400 && e.status < 500
              ? e.message
              : "Search didn't work just now. Try again.",
        );
        setResults([]);
        setStatus("error");
        setSettled(trimmed);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [trimmed]);

  const rows = useMemo(() => results.map((h) => ({ h, view: hitView(h) })), [results]);

  // The "…" menu needs the full note (edit/delete/re-extract), fetched on demand.
  const openActions = async (id: string) => {
    const note = await getNote(id).catch(() => null);
    if (note) setActionView(toView(note));
  };
  const patchHit = (id: string, patch: Partial<Note>) =>
    setResults((rs) =>
      rs.map((r) => ((r.ref_id ?? r.id) === id ? ({ ...r, ...patch } as SearchResult) : r)),
    );

  return (
    <div
      className="app-shell"
      style={{ minHeight: "100dvh" }}
      onPointerDown={() => {
        // A tap that blurs the field (iOS keyboard dismiss) must not also count as "tap outside".
        inputWasFocused.current = document.activeElement instanceof HTMLInputElement;
      }}
      onClick={(e) => {
        // Any tap outside the search field and interactive content goes back; taps on results,
        // controls or the field itself (and keyboard-dismiss taps) never do.
        // With a query typed, the first tap only dismisses the keyboard (keeps the results).
        // Only in the idle state: with results or an error on screen, a stray tap must not leave.
        if (actionView || trimmed.length >= MIN_CHARS || (inputWasFocused.current && trimmed))
          return;
        const t = e.target as HTMLElement;
        if (
          t.closest(
            "input, button, a, [role=button], .note-list, .search-field, [role=alert], [aria-modal]",
          )
        )
          return;
        if (window.getSelection()?.toString()) return;
        if (canGoBack) router.history.back();
        else navigate({ to: "/" });
      }}
    >
      <main id="main-content" className="main" tabIndex={-1}>
        <header className="page-header">
          <div>
            <button
              type="button"
              className="text-button search-back"
              onClick={() => navigate({ to: "/" })}
            >
              <Icon name="ChevronLeft" size={18} />
              Back to library
            </button>
          </div>
        </header>
        <SearchInput value={query} onChange={setQuery} placeholder="Search your saves" autoFocus />
        {trimmed.length < MIN_CHARS ? (
          <div className="search-start">
            <h2>Find something you saved</h2>
            <p>
              Search by topic, title, or a detail you remember.
              {trimmed.length > 0 && " Type at least 3 characters."}
            </p>
          </div>
        ) : status === "searching" || settled !== trimmed ? (
          <div className="search-results-label" role="status">
            Searching…
          </div>
        ) : status === "error" ? (
          <p className="error-text" role="alert">
            {errorText}
          </p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No matching saves"
            description="Try a different word, topic, or title."
          />
        ) : (
          <>
            <div className="search-results-label">
              Results for <strong>“{trimmed}”</strong>
            </div>
            <div className="note-list library-list">
              {rows.map(({ h, view }) => (
                <NoteRow
                  key={view.id}
                  note={view}
                  onOpen={() => goToNote(navigate, view.id)}
                  onActions={() => openActions(view.id)}
                  description={<Highlight text={h.ai_summary ?? ""} query={trimmed} />}
                />
              ))}
            </div>
          </>
        )}
      </main>
      {actionView && (
        <NoteActions
          view={actionView}
          onClose={() => setActionView(null)}
          onDeleted={() => {
            setResults((rs) => rs.filter((r) => (r.ref_id ?? r.id) !== actionView.id));
            setActionView(null);
          }}
          onUpdated={(patch) => patchHit(actionView.id, patch)}
        />
      )}
    </div>
  );
}
